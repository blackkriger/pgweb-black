PKG = github.com/sosedoff/pgweb
GIT_COMMIT ?= $(shell git rev-parse --short=8 HEAD)
BUILD_TIME ?= $(shell date -u +"%Y-%m-%dT%H:%M:%SZ" | tr -d '\n')
GO_VERSION ?= $(shell go version | awk {'print $$3'})

LDFLAGS = -s -w
LDFLAGS += -X $(PKG)/pkg/command.GitCommit=$(GIT_COMMIT)
LDFLAGS += -X $(PKG)/pkg/command.BuildTime=$(BUILD_TIME)
LDFLAGS += -X $(PKG)/pkg/command.GoVersion=$(GO_VERSION)

usage:
	@echo ""
	@echo "Task                 : Description"
	@echo "-----------------    : -------------------"
	@echo "make dev             : Generate development build"
	@echo "make build           : Generate production build for current OS"
	@echo "make test            : Execute test suite"
	@echo "make lint            : Execute code linter"
	@echo "make clean           : Remove all build files"
	@echo ""

test:
	go test -v -race -cover ./pkg/...

lint:
	golangci-lint run

dev:
	go build
	@echo "You can now execute ./pgweb"

build:
	go build -ldflags '${LDFLAGS}'
	@echo "You can now execute ./pgweb"

install:
	go install -ldflags '${LDFLAGS}'
	@echo "You can now execute pgweb"

clean:
	@echo "Removing all artifacts"
	@rm -rf ./pgweb ./bin/*
