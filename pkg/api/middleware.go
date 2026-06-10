package api

import (
	neturl "net/url"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/sosedoff/pgweb/pkg/command"
)

// Middleware to check database connection status before running queries
func dbCheckMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		path := strings.Replace(c.Request.URL.Path, command.Opts.Prefix, "", -1)

		// Allow whitelisted paths
		if allowedPaths[path] {
			c.Next()
			return
		}

		// Check if session exists in single-session mode
		if !command.Opts.Sessions {
			if DbClient == nil {
				badRequest(c, errNotConnected)
				return
			}

			c.Next()
			return
		}

		// Determine session ID from the client request
		sid := getSessionId(c.Request)
		if sid == "" {
			badRequest(c, errSessionRequired)
			return
		}

		// Determine the database connection handle for the session
		conn := DbSessions.Get(sid)
		if conn == nil {
			badRequest(c, errNotConnected)
			return
		}

		c.Next()
	}
}

// Middleware to inject CORS headers
func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		c.Header("Access-Control-Expose-Headers", "*")
		c.Header("Access-Control-Allow-Origin", command.Opts.CorsOrigin)
	}
}

func requireLocalQueries() gin.HandlerFunc {
	return func(c *gin.Context) {
		if QueryStore == nil {
			badRequest(c, "local queries are disabled")
			return
		}

		c.Next()
	}
}

// requireSameOrigin blocks mutating requests whose Origin/Referer doesn't match the server host so a malicious page in another tab can't trigger UPDATE/DELETE against a pgweb pinned to localhost. Non-browser clients (curl, scripts) send neither header — they pass. An explicit --cors-origin overrides the check for that origin.
func requireSameOrigin() gin.HandlerFunc {
	return func(c *gin.Context) {
		host := c.Request.Host
		allowed := command.Opts.CorsOrigin
		if origin := c.GetHeader("Origin"); origin != "" {
			if u, err := neturl.Parse(origin); err == nil && u.Host == host {
				c.Next()
				return
			}
			if allowed == "*" || (allowed != "" && origin == allowed) {
				c.Next()
				return
			}
			badRequest(c, errCrossOrigin)
			return
		}
		if ref := c.GetHeader("Referer"); ref != "" {
			if u, err := neturl.Parse(ref); err == nil && u.Host == host {
				c.Next()
				return
			}
			badRequest(c, errCrossOrigin)
			return
		}
		c.Next()
	}
}
