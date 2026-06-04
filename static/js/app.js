var appInfo             = {};
var appFeatures         = {};
var editor              = null;
var connected           = false;
var bookmarks           = {};
var default_rows_limit  = 100;
var currentObject       = null;
var autocompleteObjects = [];
var inputResizing       = false;
var inputResizeOffset   = null;

var filterOptions = {
  "equal":      "= 'DATA'",
  "not_equal":  "!= 'DATA'",
  "greater":    "> 'DATA'" ,
  "greater_eq": ">= 'DATA'",
  "less":       "< 'DATA'",
  "less_eq":    "<= 'DATA'",
  "like":       "LIKE 'DATA'",
  "ilike":      "ILIKE 'DATA'",
  "null":       "IS NULL",
  "not_null":   "IS NOT NULL"
};

function getSessionId() {
  var id = sessionStorage.getItem("session_id");

  if (!id) {
    id = guid();
    sessionStorage.setItem("session_id", id);
  }

  return id;
}

function setRowsLimit(num) {
  localStorage.setItem("rows_limit", num);
}

function getRowsLimit() {
  return parseInt(localStorage.getItem("rows_limit") || default_rows_limit);
}

function getPaginationOffset() {
  var page  = $(".current-page").data("page");
  var limit = getRowsLimit();
  return (page - 1) * limit;
}

function getPagesCount(rowsCount) {
  var limit = getRowsLimit();
  var num = parseInt(rowsCount / limit);

  if ((num * limit) < rowsCount) {
    num++;
  }

  return num;
}

function apiCall(method, path, params, cb) {
  var timeout = appFeatures.query_timeout;
  if (timeout == null) {
    timeout = 300; // in seconds
  }

  $.ajax({
    timeout: timeout * 1000, // in milliseconds
    url: "api" + path,
    method: method,
    cache: false,
    data: params,
    headers: {
      "x-session-id": getSessionId()
    },
    success: cb,
    error: function(xhr, status, data) {
      switch(status) {
        case "error":
          if (xhr.readyState == 0) { // 0 = UNSENT
            showErrorBanner("Sorry, something went wrong with your request. Refresh the page and try again!");
          }
          break;
        case "timeout":
          return cb({ error: "Query timeout after " + timeout + "s" });
      }

      var responseText;
      try {
        responseText = jQuery.parseJSON(xhr.responseText);
      }
      catch {
        responseText = { error: "Failed to parse the JSON response." };
      }
      cb(responseText);
    }
  });
}

function getInfo(cb)                        { apiCall("get", "/info", {}, cb); }
function getConnection(cb)                  { apiCall("get", "/connection", {}, cb); }
function getServerSettings(cb)              { apiCall("get", "/server_settings", {}, cb); }
function getSchemas(cb)                     { apiCall("get", "/schemas", {}, cb); }
function getObjects(cb)                     { apiCall("get", "/objects", {}, cb); }
function getTables(cb)                      { apiCall("get", "/tables", {}, cb); }
function getTableRows(table, opts, cb)      { apiCall("get", "/tables/" + table + "/rows", opts, cb); }
function getTableStructure(table, opts, cb) { apiCall("get", "/tables/" + table, opts, cb); }
function getTableIndexes(table, cb)         { apiCall("get", "/tables/" + table + "/indexes", {}, cb); }
function getTableConstraints(table, cb)     { apiCall("get", "/tables/" + table + "/constraints", {}, cb); }
function getTablesStats(cb)                 { apiCall("get", "/tables_stats", {}, cb); }
function getFunction(id, cb)                { apiCall("get", "/functions/" + id, {}, cb); }
function getHistory(cb)                     { apiCall("get", "/history", {}, cb); }
function getBookmarks(cb)                   { apiCall("get", "/bookmarks", {}, cb); }
function executeQuery(query, cb)            { apiCall("post", "/query", { query: query }, cb); }
function explainQuery(query, cb)            { apiCall("post", "/explain", { query: query }, cb); }
function analyzeQuery(query, cb)            { apiCall("post", "/analyze", { query: query }, cb); }
function disconnect(cb)                     { apiCall("post", "/disconnect", {}, cb); }

function encodeQuery(query) {
  return Base64.encode(query).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, ".");
}

function showErrorBanner(text) {
  if (window.errBannerTimeout != null) {
    clearTimeout(window.errBannerTimeout);
  }

  window.errBannerTimeout = setTimeout(function() {
    $("#error_banner").fadeOut("fast").text("");
  }, 3000);

  $("#error_banner").text(text).show();
}

function buildSchemaSection(name, objects) {
  var section = "";

  var titles = {
    "table":             "Tables",
    "view":              "Views",
    "materialized_view": "Materialized Views",
    "function":          "Functions",
    "sequence":          "Sequences"
  };

  var icons = {
    "table":             '<i class="fa fa-table"></i>',
    "view":              '<i class="fa fa-table"></i>',
    "materialized_view": '<i class="fa fa-table"></i>',
    "function":          '<i class="fa fa-bolt"></i>',
    "sequence":          '<i class="fa fa-circle-o"></i>'
  };

  var klass = "";
  if (name == "public") klass = "expanded";

  section += "<div class='schema " + klass + "'>";
  section += "<div class='schema-name'><i class='fa fa-folder-o'></i><i class='fa fa-folder-open-o'></i> " + name + "</div>";
  section += "<div class='schema-container'>";

  ["table", "view", "materialized_view", "function", "sequence"].forEach(function(group) {
    group_klass = "";
    if (name == "public" && group == "table") group_klass = "expanded";

    section += "<div class='schema-group " + group_klass + "'>";
    section += "<div class='schema-group-title'><i class='fa fa-chevron-right'></i><i class='fa fa-chevron-down'></i> " + titles[group] + " <span class='schema-group-count'>" + objects[group].length + "</span></div>";
    section += "<ul data-group='" + group + "'>";

    if (objects[group]) {
      objects[group].forEach(function(item) {
        var id = name + "." + item.name;

        // Use function OID since multiple functions with the same name might exist
        if (group == "function") {
          id = item.oid;
        }

        section += "<li class='schema-item schema-" + group + "' data-type='" + group + "' data-id='" + id + "' data-name='" + item.name + "'>" + icons[group] + "&nbsp;" + item.name + "</li>";
      });
      section += "</ul></div>";
    }
  });

  section += "</div></div>";

  return section;
}

function loadLocalQueries() {
  if (!appFeatures.local_queries) return;

  $("body").on("click", "a.load-local-query", function(e) {
    var id = $(this).data("id");

    apiCall("get", "/local_queries/" + id, {}, function(resp) {
      editor.setValue(resp.query);
      editor.clearSelection();
    });
  });

  apiCall("get", "/local_queries", {}, function(resp) {
    if (resp.error) return;

    var container = $("#load-query-dropdown").find(".dropdown-menu");

    resp.forEach(function(item) {
      var title = item.title || item.id;
      $("<li><a href='#' class='load-local-query' data-id='" + item.id + "'>" + title + "</a></li>").appendTo(container);
    });

    if (resp.length > 0) $("#load-local-query").prop("disabled", "");
    $("#load-query-dropdown").show();
  });
}

function loadSchemas() {
  $("#objects").html("");

  var emptyObjectList = function() {
    return {
      table: [],
      view: [],
      materialized_view: [],
      function: [],
      sequence: []
    }
  }

  getSchemas(function(schemasData) {
    if (schemasData.error) {
      alert("Error while fetching schemas: " + schemasData.error);
      return;
    }

    getObjects(function(data) {
      if (data.error) {
        alert("Error while fetching database objects: " + data.error);
        return;
      }

      if (Object.keys(data).length == 0) {
        data["public"] = emptyObjectList();
      }

      for (schemaName of schemasData) {
        // Allow users to see empty schemas if we dont have any objects in them
        if (!data[schemaName]) {
          data[schemaName] = emptyObjectList();
        }

        $(buildSchemaSection(schemaName, data[schemaName])).appendTo("#objects");
      }

      if (Object.keys(data).length == 1) {
        $(".schema").addClass("expanded");
      }

      // Clear out all autocomplete objects
      autocompleteObjects = [];
      for (schema in data) {
        for (kind in data[schema]) {
          if (!(kind == "table" || kind == "view" || kind == "materialized_view" || kind == "function")) {
            continue
          }

          for (item in data[schema][kind]) {
            autocompleteObjects.push({
              caption: data[schema][kind][item].name,
              value: data[schema][kind][item].name,
              meta: kind
            });
          }
        }
      }

      bindContextMenus();
    });
  });
}

function escapeHtml(str) {
  if (str != null || str != undefined) {
    return jQuery("<div/>").text(str).html();
  }

  return "<span class='null'>null</span>";
}

function unescapeHtml(str){
  var e = document.createElement("div");
  e.innerHTML = str;
  return e.childNodes.length === 0 ? "" : e.childNodes[0].nodeValue;
}

function getCurrentObject() {
  return currentObject || { name: "", type: "" };
}

function resetTable() {
  $("#results_header").html("");
  $("#results_body").html("");
  $("#results_view").html("").hide();

  $("#results").
    data("mode", "").
    removeClass("empty").
    removeClass("no-crop").
    show();
}

function performTableAction(table, action, el) {
  if (action == "truncate" || action == "delete") {
    var message = "Are you sure you want to " + action + " table " + table + " ?";
    if (!confirm(message)) return;
  }

  switch(action) {
    case "truncate":
      executeQuery("TRUNCATE TABLE " + table, function(data) {
        if (data.error) alert(data.error);
        resetTable();
      });
      break;
    case "delete":
      executeQuery("DROP TABLE " + table, function(data) {
        if (data.error) alert(data.error);
        loadSchemas();
        resetTable();
      });
      break;
    case "export":
      var format = el.data("format");
      var db = $("#current_database").text();
      var filename = db + "." + table + "." + format;
      var query = "SELECT * FROM " + table;
      openInNewWindow("api/query", { "format": format, "filename": filename, "query": query });
      break;
    case "dump":
      openInNewWindow("api/export", { "table": table });
      break;
    case "copy":
      copyToClipboard(table.split('.')[1]);
      break;
    case "analyze":
      executeQuery("ANALYZE " + table, function(data) {
        if (data.error) alert(data.error);
        resetTable();
      });
      break;
  }
}

function performViewAction(view, action, el) {
  if (action == "delete") {
    var message = "Are you sure you want to " + action + " view " + view + " ?";
    if (!confirm(message)) return;
  }

  switch(action) {
    case "delete":
      executeQuery("DROP VIEW " + view, function(data) {
        if (data.error) alert(data.error);
        loadSchemas();
        resetTable();
      });
      break;
    case "export":
      var format = el.data("format");
      var db = $("#current_database").text();
      var filename = db + "." + view + "." + format;
      var query = "SELECT * FROM " + view;
      openInNewWindow("api/query", { "format": format, "filename": filename, "query": query });
      break;
    case "copy":
      copyToClipboard(view.split('.')[1]);
      break;
    case "copy_def":
      executeQuery("SELECT pg_get_viewdef('" + view + "', true);", function(data) {
        if (data.error) {
          alert(data.error);
          return;
        }
        copyToClipboard(data.rows[0]);
      });
      break;
    case "view_def":
      executeQuery("SELECT pg_get_viewdef('" + view + "', true);", function(data) {
        if (data.error) {
          alert(data.error);
          return;
        }
        showViewDefinition(view, data.rows[0]);
      });
      break;
  }
}

function performRowAction(action, value) {
  if (action == "stop_query") {
    if (!confirm("Are you sure you want to stop the query?")) return;
    executeQuery("SELECT pg_cancel_backend(" + value + ");", function(data) {
      if (data.error) alert(data.error);
      setTimeout(showActivityPanel, 1000);
    });
  }
}

function sortArrow(direction) {
  switch (direction) {
    case "ASC":
      return "&#x25B2;";
    case "DESC":
      return "&#x25BC;";
    default:
      return "";
  }
}

function buildTable(results, sortColumn, sortOrder, options) {
  if (!options) options = {};
  var action = options.action;

  resetTable();

  if (results.error) {
    $("#results_header").html("");
    $("#results_body").html("<tr><td>ERROR: " + results.error + "</tr></tr>");
    return;
  }

  if (results.rows.length == 0) {
    $("#results_header").html("");
    $("#results_body").html("<tr><td>No records found</td></tr>");
    if (results.stats) {
      $("#result-rows-count").html(results.stats.query_duration_ms + " ms");
    } else {
      $("#result-rows-count").html("");
    }
    $("#results").addClass("empty");
    return;
  }

  var cols = "";
  var rows = "";

  // Leading checkbox column for row multi-selection (browse views only).
  if (options.selectable) cols += "<th class='row-select-col'><input type='checkbox' class='row-select-all' title='Select all rows on this page' /></th>";

  results.columns.forEach(function(col) {
    if (col === sortColumn) {
      cols += "<th class='table-header-col active' data-name='" + col + "' data-order=" + sortOrder + ">" + col + "&nbsp;" + sortArrow(sortOrder) + "</th>";
    } else {
      cols += "<th class='table-header-col' data-name='" + col + "'>" + col + "</th>";
    }
  });

  // No header to make the column non-sortable
  if (action) {
    cols += "<th></th>";

    // Determine which column contains the data attribute
    action.dataColumn = results.columns.indexOf(action.data);
  }

  results.rows.forEach(function(row) {
    var r = "";

    // Leading checkbox cell — checked mirrors the row's .selected state.
    if (options.selectable) r += "<td class='row-select-col'><input type='checkbox' class='row-select-box' /></td>";

    // Add all actual row data here. data-name carries the column name so cell edit / Set NULL / delete / filter resolve it without a positional th lookup (the leading checkbox column would otherwise shift those indices).
    for (i in row) {
      r += "<td data-col='" + i + "' data-name='" + results.columns[i] + "'><div>" + escapeHtml(row[i]) + "</div></td>";
    }

    // Add row action button
    if (action) {
      r += "<td><a class='btn btn-xs btn-" + action.style + " row-action' data-action='" + action.name + "' data-value='" + row[action.dataColumn] + "' href='#'>" + action.title + "</a></td>";
    }

    rows += "<tr>" + r + "</tr>";
  });

  $("#results_header").html(cols);
  $("#results_body").html(rows);

  // Show number of rows rendered on the page
  if (results.stats) {
    $("#result-rows-count").html(results.stats.rows_count + " rows in " + results.stats.query_duration_ms + " ms");
  } else {
    $("#result-rows-count").html(results.rows.length + " rows");
  }
}

function setCurrentTab(id) {
  // Pagination + query bar are only for the rows tab
  if (id != "table_content") {
    $("#body").removeClass("with-pagination").removeClass("with-rows-query");
  }

  $("#nav ul li.selected").removeClass("selected");
  $("#" + id).addClass("selected");

  // Persist tab selection into the session storage
  sessionStorage.setItem("tab", id);
}

function showQueryHistory() {
  getHistory(function(data) {
    var rows = [];

    for(i in data) {
      rows.unshift([parseInt(i) + 1, data[i].query, data[i].timestamp]);
    }

    buildTable({ columns: ["id", "query", "timestamp"], rows: rows });

    setCurrentTab("table_history");
    $("#input").hide();
    $("#body").prop("class", "full");
    $("#results").addClass("no-crop");
  });
}

function showTableIndexes() {
  var name = getCurrentObject().name;

  if (name.length == 0) {
    alert("Please select a table!");
    return;
  }

  getTableIndexes(name, function(data) {
    setCurrentTab("table_indexes");
    buildTable(data);

    $("#input").hide();
    $("#body").prop("class", "full");
    $("#results").addClass("no-crop");
  });
}

function showTableConstraints() {
  var name = getCurrentObject().name;

  if (name.length == 0) {
    alert("Please select a table!");
    return;
  }

  getTableConstraints(name, function(data) {
    setCurrentTab("table_constraints");
    buildTable(data);

    $("#input").hide();
    $("#body").prop("class", "full");
    $("#results").addClass("no-crop");
  });
}

function showTableInfo() {
  var name = getCurrentObject().name;

  if (name.length == 0) {
    alert("Please select a table!");
    return;
  }

  apiCall("get", "/tables/" + name + "/info", {}, function(data) {
    $(".table-information .lines").show();
    $("#table_total_size").text(data.total_size);
    $("#table_data_size").text(data.data_size);
    $("#table_index_size").text(data.index_size);
    $("#table_rows_count").text(data.rows_count);
    $("#table_encoding").text("Unknown");
  });

  buildTableFilters(name, getCurrentObject().type);
}

function updatePaginator(pagination) {
  if (!pagination) {
    $(".current-page").data("page", 1).data("pages", 1);
    $("button.page").text("1 of 1");
    $(".prev-page, .next-page").prop("disabled", "disabled");
    return;
  }

  $(".current-page").
    data("page", pagination.page).
    data("pages", pagination.pages_count);

  if (pagination.page > 1) {
    $(".prev-page").prop("disabled", "");
  }
  else {
    $(".prev-page").prop("disabled", "disabled");
  }

  if (pagination.pages_count > 1 && pagination.page < pagination.pages_count) {
    $(".next-page").prop("disabled", "");
  }
  else {
    $(".next-page").prop("disabled", "disabled");
  }

  $("#total_records").text(pagination.rows_count);
  if (pagination.pages_count == 0) pagination.pages_count = 1;
  $("button.page").text(pagination.page + " of " + pagination.pages_count);
}

function showTableContent(sortColumn, sortOrder) {
  var name = getCurrentObject().name;

  if (name.length == 0) {
    alert("Please select a table!");
    return;
  }

  if (getCurrentObject().type == "function") {
    alert("Cant view rows for a function");
    return;
  }

  var opts = {
    limit:       getRowsLimit(),
    offset:      getPaginationOffset(),
    sort_column: sortColumn,
    sort_order:  sortOrder
  };

  var filter = {
    column: $(".filters select.column").val(),
    op:     $(".filters select.filter").val(),
    input:  $(".filters input").val()
  };

  // Apply filtering only if column is selected
  if (filter.column && filter.op) {
    var where = [
      '"' + filter.column + '"',
      filterOptions[filter.op].replace("DATA", filter.input)
    ].join(" ");

    opts["where"] = where;
  }

  getTableRows(name, opts, function(data) {
    $("#input").hide();
    $("#body").prop("class", "with-pagination with-rows-query");
    if (rowsEditor) {
      rowsEditor.setValue(buildBrowseQuery(name, opts));
      rowsEditor.clearSelection();
      rowsEditor.resize();
      layoutRowsQuery();
    }

    buildTable(data, sortColumn, sortOrder, { selectable: true });
    setCurrentTab("table_content");
    updatePaginator(data.pagination);

    $("#results").data("mode", "browse").data("table", name);
    fetchFkMap(name, $.noop);
  });
}

// Reconstruct the SELECT that the rows view runs (minus the auto LIMIT/OFFSET) so it can be shown and edited in the query bar.
function buildBrowseQuery(table, opts) {
  var sql = "SELECT * FROM " + getQuotedSchemaTableName(table);
  if (opts.where) sql += " WHERE " + opts.where;
  if (opts.sort_column) sql += ' ORDER BY "' + opts.sort_column + '" ' + (opts.sort_order || "ASC");
  return sql;
}

// Run the (possibly edited) query bar SQL in place: render its rows, keeping the bar and pagination/filters visible. The rows bar always runs against the current table, so keep the result editable (cell edit / Set NULL / row + bulk delete) just like plain browse — rows missing a primary key column simply fail server-side with an error banner.
function runRowsQuery() {
  var sql = rowsEditor ? $.trim(rowsEditor.getValue()) : "";
  if (!sql) return;

  var table = $("#results").data("table");
  executeQuery(sql, function(data) {
    buildTable(data, null, null, { selectable: true });
    $("#results").data("mode", "browse").data("table", table);
    fetchFkMap(table, $.noop);
  });
}

function showPaginatedTableContent() {
  var activeColumn = $("#results th.active");
  var sortColumn = null;
  var sortOrder = null;

  if (activeColumn.length) {
    sortColumn = activeColumn.data("name");
    sortOrder = activeColumn.data("order");
  }

  showTableContent(sortColumn, sortOrder);
}

function showDatabaseStats() {
  getTablesStats(function(data) {
    buildTable(data);

    setCurrentTab("table_structure");
    $("#input").hide();
    $("#body").prop("class", "full");
    $("#results").addClass("no-crop");
  });
}

function downloadDatabaseStats() {
  openInNewWindow("api/tables_stats", { format: "csv", export: "true" });
}

function showServerSettings() {
  getServerSettings(function(data) {
    buildTable(data);

    setCurrentTab("table_content");
    $("#input").hide();
    $("#body").prop("class", "full");
    $("#results").addClass("no-crop");
  });
}

function showTableStructure() {
  var name = getCurrentObject().name;

  if (name.length == 0) {
    alert("Please select a table!");
    return;
  }

  setCurrentTab("table_structure");

  $("#input").hide();
  $("#body").prop("class", "full");

  getTableStructure(name, { type: getCurrentObject().type }, function(data) {
    if (getCurrentObject().type == "function") {
      var name = data.rows[0][data.columns.indexOf("proname")];
      var definition = data.rows[0][data.columns.indexOf("functiondef")];
      showFunctionDefinition(name, definition);
      return
    }

    buildTable(data);
    $("#results").addClass("no-crop");
  });
}

function showViewDefinition(viewName, viewDefintion) {
  setCurrentTab("table_structure");
  renderResultsView("View definition for: <strong>" + viewName + "</strong>", viewDefintion);
}

function showFunctionDefinition(functionName, definition) {
  setCurrentTab("table_structure");
  renderResultsView("Function definition for: <strong>" + functionName + "</strong>", definition)
}

function renderResultsView(title, content) {
  $("#results").addClass("no-crop");
  $("#input").hide();
  $("#body").prop("class", "full");
  $("#results").hide();

  var title = $("<div/>").prop("class", "title").html(title);
  var content = $("<pre/>").text(content);

  $("<div/>").
    html("<i class='fa fa-copy'></i>").
    addClass("copy").
    appendTo(content);

  $("#results_view").html("");
  title.appendTo("#results_view");
  content.appendTo("#results_view");
  $("#results_view").show();
}

function showQueryPanel() {
  if (!$("#table_query").hasClass("selected")) {
    resetTable();
  }

  setCurrentTab("table_query");
  editor.focus();

  $("#input").show();
  $("#body").prop("class", "")
}

function showConnectionPanel() {
  setCurrentTab("table_connection");
  $("#input").hide();
  $("#body").addClass("full");

  getConnection(function(data) {
    var rows = [];

    for(key in data) {
      rows.push([key, data[key]]);
    }

    buildTable({
      columns: ["attribute", "value"],
      rows: rows
    });
  });
}

function showActivityPanel() {
  var options = {
    action: {
      name: "stop_query",
      title: "stop",
      data: "pid",
      style: "danger"
    }
  }

  setCurrentTab("table_activity");
  $("#input").hide();
  $("#body").addClass("full");

  apiCall("get", "/activity", {}, function(data) {
    buildTable(data, null, null, options);
  });
}

function showQueryProgressMessage() {
  $("#run, #explain-dropdown-toggle, #csv, #json, #xml, #load-local-query").prop("disabled", true);
  $("#explain-dropdown").removeClass("open");
  $("#query_progress").show();
}

function hideQueryProgressMessage() {
  $("#run, #explain-dropdown-toggle, #csv, #json, #xml, #load-local-query").prop("disabled", false);
  $("#query_progress").hide();
}

function getEditorSelection() {
  // Return the exact selection if user has one
  var query = $.trim(editor.getSelectedText());
  if (query.length > 0) {
    return query;
  }

  query = editor.getValue();

  // Determine which query we should run when there are multiple queries without a delimiter
  if (query.indexOf(";") == -1) {
    var subquery = getSubquery(query, editor.getCursorPosition());

    if (subquery) {
      // Highlight query selection so user knows what is being executed
      if (subquery.numChunks > 1) {
        editor.selection.setSelectionRange({
          start: { row: subquery.startRow, column: 0 },
          end: { row: subquery.endRow, column: 0 },
        })
      }

      return subquery.text;
    }
  }

  return query;
}

function getSubquery(text, cursor) {
  var lines = text.split("\n");
  var startRow = undefined;
  var numChunks = 0;
  var ranges = [];

  for (i = 0; i < lines.length; i++) {
    if (lines[i].trim().length == 0) {
      if (startRow >= 0 && cursor.row >= startRow && cursor.row <= i) {
        ranges.push([startRow, i]);
      }

      numChunks++;
      startRow = undefined;
      continue;
    }

    if (startRow === undefined) {
      startRow = i;
    }

    if (i == lines.length - 1) {
      ranges.push([startRow, i + 1]);
      numChunks++;
    }
  }

  if (ranges.length > 0) {
    return {
      text: lines.slice(ranges[0][0], ranges[0][1]).join("\n"),
      startRow: ranges[0][0],
      endRow: ranges[0][1],
      numChunks: numChunks
    };
  }
}

function runQuery() {
  setCurrentTab("table_query");
  showQueryProgressMessage();

  var query = getEditorSelection();
  if (query.length == 0) {
    hideQueryProgressMessage();
    return;
  }

  executeQuery(query, function(data) {
    buildTable(data);

    hideQueryProgressMessage();
    $("#input").show();
    $("#body").removeClass("full");
    $("#results").data("mode", "query");

    if (query.toLowerCase().indexOf("explain") != -1) {
      $("#results").addClass("no-crop");
    }

    // Reload objects list if anything was created/deleted
    if (query.match(/(create|drop)\s/i)) {
      loadSchemas();
    }
  });
}

function runExplain() {
  setCurrentTab("table_query");
  showQueryProgressMessage();

  var query = getEditorSelection();
  if (query.length == 0) {
    hideQueryProgressMessage();
    return;
  }

  explainQuery(query, function(data) {
    buildTable(data);

    hideQueryProgressMessage();
    $("#input").show();
    $("#body").removeClass("full");
    $("#results").addClass("no-crop");
  });
}

function runAnalyze() {
  setCurrentTab("table_query");
  showQueryProgressMessage();

  var query = getEditorSelection();
  if (query.length == 0) {
    hideQueryProgressMessage();
    return;
  }

  analyzeQuery(query, function(data) {
    buildTable(data);

    hideQueryProgressMessage();
    $("#input").show();
    $("#body").removeClass("full");
    $("#results").addClass("no-crop");
  });
}

function generateURL(path, params) {
  var url = new URL(window.location.href.split("#")[0]);

  url.pathname += path;
  for (key in params) {
    url.searchParams.append(key, params[key]);
  }

  // Automatically append session id so we dont have to do that everywhere
  url.searchParams.append("_session_id", getSessionId());

  return url.toString();
}

function openInNewWindow(path, params) {
  var url = generateURL(path, params);
  var win = window.open(url, '_blank');
  win.focus();
}

function exportTo(format) {
  var query = getEditorSelection();
  if (query.length == 0) {
    return;
  }

  setCurrentTab("table_query");

  openInNewWindow("api/query", {
    "format": format,
    "query": encodeQuery(query)
  })
}

// Fetch all unique values for the selected column in the table
function showUniqueColumnsValues(table, column, showCounts) {
  var query = 'SELECT DISTINCT "' + column + '" FROM ' + table;

  // Display results ordered by counts.
  // This could be slow on large sets without an index.
  if (showCounts) {
    query = 'SELECT DISTINCT "' + column + '", COUNT(1) AS total_count FROM ' + table + ' GROUP BY "' + column + '" ORDER BY total_count DESC';
  }

  executeQuery(query, function(data) {
    $("#input").hide();
    $("#body").prop("class", "full");
    $("#results").data("mode", "query");
    buildTable(data);
  });
}

// Show numeric stats on the field
function showFieldNumStats(table, column) {
  var query = 'SELECT count(1), min(' + column + '), max(' + column + '), avg(' + column + ') FROM ' + table;

  executeQuery(query, function(data) {
    $("#input").hide();
    $("#body").prop("class", "full");
    $("#results").data("mode", "query");
    buildTable(data);
  });
}

function buildTableFilters(name, type) {
  getTableStructure(name, { type: type }, function(data) {
    if (data.rows.length == 0) {
      $("#pagination .filters").hide();
    }
    else {
      $("#pagination .filters").show();
    }

    $("#pagination select.column").html("<option value='' selected>Select column</option>");

    for (var i = 0; i < data.rows.length; i++) {
      var row = data.rows[i];

      var el = $("<option/>").attr("value", row[0]).text(row[0]);
      $("#pagination select.column").append(el);
    }
  });
}

var rowsEditor = null;

var objectAutocompleter = {
  getCompletions: function (editor, session, pos, prefix, callback) {
    callback(null, autocompleteObjects);
  }
}

function initEditor() {
  var writeQueryTimeout = null;

  editor = ace.edit("custom_query");
  editor.setOptions({
    enableBasicAutocompletion: true,
    enableLiveAutocompletion: true,
  });
  editor.completers.push(objectAutocompleter);

  editor.setFontSize(13);
  editor.setTheme("ace/theme/tomorrow");
  editor.setShowPrintMargin(false);
  editor.getSession().setMode("ace/mode/pgsql");
  editor.getSession().setTabSize(2);
  editor.getSession().setUseSoftTabs(true);

  editor.commands.addCommands([{
    name: "run_query",
    bindKey: {
      win: "Ctrl-Enter",
      mac: "Command-Enter"
    },
    exec: function(editor) {
      runQuery();
    }
  }, {
    name: "explain_query",
    bindKey: {
      win: "Ctrl-E",
      mac: "Command-E"
    },
    exec: function(editor) {
      runExplain();
    }
  }]);

  editor.on("change", function() {
    if (writeQueryTimeout) {
      clearTimeout(writeQueryTimeout);
    }

    writeQueryTimeout = setTimeout(function() {
      localStorage.setItem("pgweb_query", editor.getValue());
    }, 1000);
  });

  var query = localStorage.getItem("pgweb_query");
  if (query && query.length > 0) {
    editor.setValue(query);
    editor.clearSelection();
  }

  initRowsEditor();
}

// ACE editor for the Rows-view query bar — same SQL mode + autocompleter as the main editor 
function initRowsEditor() {
  rowsEditor = ace.edit("rows_query_editor");
  rowsEditor.setOptions({
    enableBasicAutocompletion: true,
    enableLiveAutocompletion: true,
  });
  rowsEditor.completers.push(objectAutocompleter);
  rowsEditor.setFontSize(13);
  rowsEditor.setTheme("ace/theme/tomorrow");
  rowsEditor.setShowPrintMargin(false);
  rowsEditor.setHighlightActiveLine(false);
  rowsEditor.renderer.setShowGutter(false);
  rowsEditor.getSession().setMode("ace/mode/pgsql");
  rowsEditor.getSession().setUseWrapMode(false);

  rowsEditor.commands.addCommand({
    name: "run_rows_query",
    bindKey: { win: "Return|Ctrl-Enter", mac: "Return|Command-Enter" },
    exec: function(ed) {
      if (ed.completer && ed.completer.activated) return false;
      runRowsQuery();
    }
  });

  // The editor has a CSS resize grip (bottom-right) 
  if (window.ResizeObserver) {
    new ResizeObserver(function() {
      rowsEditor.resize();
      layoutRowsQuery();
    }).observe(document.getElementById("rows_query_editor"));
  }
}

// Publish the query bar's height as --rq-h so the CSS offsets for pagination and output follow it as it's resized 
function layoutRowsQuery() {
  var $rq = $("#rows_query");
  if (!$rq.is(":visible")) return;
  document.getElementById("body").style.setProperty("--rq-h", ($rq.outerHeight() || 40) + "px");
}

function addShortcutTooltips() {
  if (navigator.userAgent.indexOf("OS X") > 0) {
    $("#run").attr("title", "Shortcut: ⌘+Enter");
    $("#explain").attr("title", "Shortcut: ⌘+E");
  }
  else {
    $("#run").attr("title", "Shortcut: Ctrl+Enter");
    $("#explain").attr("title", "Shortcut: Ctrl+E");
  }
}

// Get the latest release from Github API
function getLatestReleaseInfo(current) {
  try {
    $.get("https://api.github.com/repos/sosedoff/pgweb/releases/latest", function(release) {
      if (release.name != current.version) {
        var message = "Update available. Check out " + release.tag_name + " on <a target='_blank' href='" + release.html_url + "'>Github</a>";
        $(".connection-settings .update").html(message).fadeIn();
      }
    });
  }
  catch(error) {
    console.log("Cant get last release from github:", error);
  }
}

function showConnectionSettings() {
  // Show the current postgres version
  $(".connection-settings .version").text("v" + appInfo.version).show();
  $("#connection_window").show();
  initConnectionWindow();

  // Check github release page for updates
  getLatestReleaseInfo(appInfo);

  getBookmarks(function(data) {
    if (data.error) {
      console.log("Error while fetching bookmarks:", data.error);
      return;
    }

    if (data.length > 0) {
      // Set bookmarks in global var
      bookmarks = data;

      // Remove all existing bookmark options
      $("#connection_bookmarks").html("");

      // Add blank option
      $("<option value=''>Select a bookmarked database to connect to</option>").appendTo("#connection_bookmarks");

      // Add all available bookmarks
      for (key of data) {
        $("<option value='" + key + "''>" + key + "</option>").appendTo("#connection_bookmarks");
      }

      $(".bookmarks").show();
    }
    else {
      if (appFeatures.bookmarks_only) {
        $("#connection_error").html("Running in <b>bookmarks-only</b> mode but <b>NO</b> bookmarks configured.").show();
        $(".open-connection").hide();
      } else {
        $(".bookmarks").hide();
      }
    }
  });
}

function initConnectionWindow() {
  if (appFeatures.bookmarks_only) {
    $(".connection-group-switch").hide();
    $(".connection-scheme-group").hide();
    $(".connection-bookmarks-group").show();
    $(".connection-standard-group").hide();
    $(".connection-ssh-group").hide();
  } else {
    $(".connection-group-switch").show();
    $(".connection-scheme-group").hide();
    $(".connection-bookmarks-group").show();
    $(".connection-standard-group").show();
    $(".connection-ssh-group").hide();
  }
}

function getConnectionString() {
  var url  = $.trim($("#connection_url").val());
  var mode = $(".connection-group-switch button.active").attr("data");
  var ssl  = $("#connection_ssl").val();

  if (mode == "standard" || mode == "ssh") {
    var host = $("#pg_host").val();
    var port = $("#pg_port").val();
    var user = $("#pg_user").val();
    var pass = encodeURIComponent($("#pg_password").val());
    var db   = $("#pg_db").val();

    if (port.length == 0) {
      port = "5432";
    }

    url = "postgres://" + user + ":" + pass + "@" + host + ":" + port + "/" + db + "?sslmode=" + ssl;
  }
  else {
    var local = url.indexOf("localhost") != -1 || url.indexOf("127.0.0.1") != -1;

    if (local && url.indexOf("sslmode") == -1) {
      url += "?sslmode=" + ssl;
    }
  }

  return url;
}

// Add a context menu to the results table header columns
function bindTableHeaderMenu() {
  $("#results_header").contextmenu({
    scopes: "th",
    target: "#results_header_menu",
    before: function(e, element, target) {
      // Enable menu for browsing table rows view only.
      if ($("#results").data("mode") != "browse") {
        e.preventDefault();
        this.closemenu();
        return false;
      }
    },
    onItem: function(context, e) {
      var menuItem = $(e.target);

      switch(menuItem.data("action")) {
        case "copy_name":
          copyToClipboard($(context).data("name"));
          break;

        case "unique_values":
          showUniqueColumnsValues(
            $("#results").data("table"), // table name
            $(context).data("name"),     // column name
            menuItem.data("counts")      // display counts
          );
          break;

        case "num_stats":
          showFieldNumStats(
            $("#results").data("table"), // table name
            $(context).data("name")      // column name
          );
          break;
      }
    }
  });

  $("#results_body").contextmenu({
    scopes: "td",
    target: "#results_row_menu",
    before: function(e, element, target) {
      var browseMode = $("#results").data("mode");
      var isEmpty    = $("#results").hasClass("empty");
      var isAllowed  = browseMode == "browse" || browseMode == "query";

      if (isEmpty || !isAllowed) {
        e.preventDefault();
        this.closemenu();
        return false;
      }

      // Editing actions (select / Set NULL / row + bulk delete) only make sense while browsing a single table's rows, where each row carries its primary key.
      var editable = browseMode == "browse";
      $("#results_row_menu .row-edit-item, #results_row_menu .edit-divider").toggle(editable);

      var selected = editable ? selectedRowCount() : 0;
      // Export-selected entries only make sense with a checkbox selection.
      $("#results_row_menu .row-export-item").toggle(editable && selected > 0);
      if (editable) {
        // One delete entry: bulk when rows are checkbox-selected, single row otherwise.
        $("#results_row_menu [data-action='delete_row']").text(selected > 0 ? "Delete Selected (" + selected + ")…" : "Delete Row…");
      }

      // FK navigation: a top "Go to <table>.<column>" entry for a foreign-key cell (browse only, non-null). fkCache is warmed when the table loads.
      var fk = null, fkVal = null;
      if (editable) {
        var $td = $(e.target).closest("td");
        var col = $td.data("name");
        var map = fkCache[$("#results").data("table")] || {};
        var $div = $td.children("div");
        if (col && map[col] && !$div.children("span.null").length) {
          fk = map[col];
          fkVal = $div.text();
        }
      }
      $("#results_row_menu .fk-goto-item, #results_row_menu .fk-goto-divider").toggle(!!fk);
      if (fk) {
        $("#results_row_menu [data-action='fk_goto']").text("Go to " + fk.table + "." + fk.column).data("fk", fk).data("fkval", fkVal);
      }
    },
    onItem: function(context, e) {
      var menuItem = $(e.target);

      switch(menuItem.data("action")) {
        case "fk_goto":
          var fk = $("#results_row_menu [data-action='fk_goto']").data("fk");
          if (fk) openFkTarget(fk.table, fk.column, $("#results_row_menu [data-action='fk_goto']").data("fkval"));
          break;
        case "display_value":
          showCellModal($(context).text());
          break;
        case "copy_value":
          copyToClipboard($(context).text());
          break;
        case "set_null":
          setCellNull($(context).children("div"));
          break;
        case "delete_row":
          if (selectedRowCount() > 0) {
            deleteSelectedRows();
          } else {
            deleteRow($(context).closest("tr"));
          }
          break;
        case "filter_by_value":
          var colValue = $(context).text();
          var colName  = $(context).data("name");

          $("select.column").val(colName);
          $("select.filter").val("equal");
          $("#table_filter_value").val(colValue);
          $("#rows_filter").submit();
      }
    }
  });
}

function bindCurrentDatabaseMenu() {
  $("#current_database").contextmenu({
    target: "#current_database_context_menu",
    onItem: function(context, e) {
      var menuItem = $(e.target);

      switch(menuItem.data("action")) {
        case "show_db_stats":
          showDatabaseStats();
          break;
        case "download_db_stats":
          downloadDatabaseStats();
          break;
        case "server_settings":
          showServerSettings();
          break;
        case "export":
          openInNewWindow("api/export");
          break;
      }
    }
  });
}

function bindDatabaseObjectsFilter() {
  var filterTimeout = null;

  $("#filter_database_objects").on("keyup", function (e) {
    clearTimeout(filterTimeout);

    var val = $(this).val().trim();

    // Reset search on ESC
    if (e.keyCode == 27 || val == "") {
      resetObjectsFilter();
      return;
    }

    $(".clear-objects-filter").show();
    $(".schema-group").addClass("expanded");

    filterTimeout = setTimeout(function() {
      filterObjectsByName(val)
    }, 200);
  });

  $(".clear-objects-filter").on("click", function(e) {
    resetObjectsFilter();
  });
}

function resetObjectsFilter() {
  $("#filter_database_objects").val("");
  $("#objects li.schema-item").show();
  $(".clear-objects-filter").hide();
}

function filterObjectsByName(query) {
  $("#objects li.schema-item").each(function (idx, el) {
    var item = $(el);
    var name = $(el).data("name");

    if (name.indexOf(query) < 0) {
      item.hide();
    } else {
      item.show();
    }
  });
}

function getQuotedSchemaTableName(table) {
  if (typeof table === "string" && table.indexOf(".") > -1) {
    var schemaTableComponents = table.split(".");
    return ['"', schemaTableComponents[0], '"."', schemaTableComponents[1], '"'].join('');
  }
  return table;
}

function bindContextMenus() {
  bindTableHeaderMenu();
  bindCurrentDatabaseMenu();

  $(".schema-group ul").each(function(id, el) {
    var group = $(el).data("group");

    if (group == "table") {
      $(el).contextmenu({
        target: "#tables_context_menu",
        scopes: "li.schema-table",
        onItem: function(context, e) {
          var el      = $(e.target);
          var table   = getQuotedSchemaTableName($(context[0]).data("id"));
          var action  = el.data("action");
          performTableAction(table, action, el);
        }
      });
    }

    if (group == "view") {
      $(el).contextmenu({
        target: "#view_context_menu",
        scopes: "li.schema-view",
        onItem: function(context, e) {
          var el      = $(e.target);
          var table   = getQuotedSchemaTableName($(context[0]).data("id"));
          var action  = el.data("action");
          performViewAction(table, action, el);
        }
      });
    }

    if (group == "materialized_view") {
      $(el).contextmenu({
        target: "#view_context_menu",
        scopes: "li.schema-materialized_view",
        onItem: function(context, e) {
          var el      = $(e.target);
          var table   = getQuotedSchemaTableName($(context[0]).data("id"));
          var action  = el.data("action");
          performViewAction(table, action, el);
        }
      });
    }
  });
}

function toggleDatabaseSearch() {
  $("#current_database").toggle();
  $("#database_search").toggle();
}

function enableDatabaseSearch(data) {
  var input = $("#database_search");

  input.typeahead("destroy");

  input.typeahead({
    source: data,
    minLength: 0,
    items: "all",
    autoSelect: false,
    fitToElement: true
  });

  input.typeahead("lookup").focus();

  input.on("focusout", function(e){
    toggleDatabaseSearch();
    input.off("focusout");
  });
}

function bindInputResizeEvents() {
  var height = sessionStorage.getItem("input_height");
  if (height) {
    resizeInput(height);
    checkInputSize();
  }

  $("body").on("mousemove", onInputResize);
  $("body").on("mouseup", endInputResize);
  $("#input_resize_handler").on("mousedown", beginInputResize);
  $(window).on("resize", checkInputSize);
}

function checkInputSize() {
  var inputHeight = $("#input").height();
  var bodyHeight = $("#body").height();

  if (bodyHeight == 0 || inputHeight == 0) return;

  if (inputHeight > bodyHeight || bodyHeight - inputHeight < 200) {
    resizeInput(bodyHeight - 200);
  }
}

function resizeInput(height) {
  if (height < 100) height = 100;

  var diff = 50 + 12; // actions box + padding (classic layout); themes ignore it (absolute)

  $("#input").height(height);
  $("#input .input-wrapper").height(height - diff);
  $("#custom_query").height(height - diff);
  $("#output").css("top", height + "px");

  if (editor) {
    editor.resize();
  }
}

function beginInputResize() {
  inputResizing = true;
  inputResizeOffset = $("#input").offset().top;

  $("html").css("cursor", "row-resize");
  $("#input_resize_handler").addClass("dragging");
}

function endInputResize() {
  if (!inputResizing) return;

  inputResizing = false;
  inputResizeOffset = null;

  $("html").css("cursor", "auto");
  $("#input_resize_handler").removeClass("dragging");

  // Save current settings for page reloads
  sessionStorage.setItem("input_height", $("#input").height());
}

function onInputResize(event) {
  if (!inputResizing) return;

  var computedHeight = event.clientY - inputResizeOffset;
  if (computedHeight < 150) computedHeight = 150;

  resizeInput(computedHeight);
}

// Read-only value viewer, used outside the browse view where rows are not editable.
function displayCellValue($div) {
  showCellModal($div.text());
}

// Original value of a cell div: null for SQL NULL, otherwise its text.
function cellValue($div) {
  return $div.children("span.null").length ? null : $div.text();
}

function renderCellValue($div, value) {
  $div.removeClass("editing");
  if (value === null) {
    $div.html("<span class='null'>null</span>");
  } else {
    $div.text(value);
  }
}

// Full original row as a column -> value map, used by the backend to locate the row by its primary key.
function collectRowValues($tr) {
  var values = {};
  $tr.children("td[data-col]").each(function() {
    var name = $(this).data("name");
    if (name != null) values[name] = cellValue($(this).children("div"));
  });
  return values;
}

function saveCellValue($div, column, value, isNull, rowValues, original) {
  var params = {
    column: column,
    value:  value,
    null:   isNull ? "true" : "false",
    row:    JSON.stringify(rowValues)
  };

  apiCall("post", "/tables/" + $("#results").data("table") + "/update", params, function(resp) {
    if (resp && resp.error) {
      showErrorBanner("Update failed: " + resp.error);
      renderCellValue($div, original);
      return;
    }

    var affected = (resp && resp.rows && resp.rows[0]) ? resp.rows[0][0] : 0;
    if (!affected) {
      showErrorBanner("No rows updated — the row may have changed. Refresh and try again.");
      renderCellValue($div, original);
      return;
    }

    renderCellValue($div, isNull ? null : value);
  });
}

function setCellNull($div) {
  if ($("#results").data("mode") != "browse") return;

  var $td = $div.parent();
  var column = $td.data("name");
  if (column == null || cellValue($div) === null) return;

  saveCellValue($div, column, "", true, collectRowValues($td.closest("tr")), cellValue($div));
}

function deleteRow($tr) {
  if ($("#results").data("mode") != "browse") return;
  if (!confirm("Delete this row? This cannot be undone.")) return;

  var rowValues = collectRowValues($tr);
  apiCall("post", "/tables/" + $("#results").data("table") + "/delete", { row: JSON.stringify(rowValues) }, function(resp) {
    if (resp && resp.error) {
      showErrorBanner("Delete failed: " + resp.error);
      return;
    }
    var affected = (resp && resp.rows && resp.rows[0]) ? resp.rows[0][0] : 0;
    if (!affected) {
      showErrorBanner("No rows deleted — the row may have changed. Refresh and try again.");
      return;
    }
    $tr.remove();
  });
}

// Row selection for bulk actions is its own stream 
function selectedRowCount() {
  return $("#results_body input.row-select-box:checked").length;
}

function clearRowSelection() {
  $("#results_body input.row-select-box:checked").prop("checked", false);
  $("#results_body tr.row-checked").removeClass("row-checked");
  syncSelectAll();
}

// Keep the header "select all" box reflecting the page: checked when every row is ticked, indeterminate while only some are, unchecked when none. Highlight follows automatically via the tr:has(:checked) CSS rule.
function syncSelectAll() {
  var $all = $("#results_header input.row-select-all");
  if (!$all.length) return;
  var total   = $("#results_body input.row-select-box").length;
  var checked = $("#results_body input.row-select-box:checked").length;
  $all.prop("checked", total > 0 && checked === total);
  $all.prop("indeterminate", checked > 0 && checked < total);
}

function deleteSelectedRows() {
  if ($("#results").data("mode") != "browse") return;

  var $rows = $("#results_body input.row-select-box:checked").closest("tr");
  if (!$rows.length) return;
  if (!confirm("Delete " + $rows.length + " selected row(s)? This cannot be undone.")) return;

  var payload = [];
  $rows.each(function() { payload.push(collectRowValues($(this))); });

  apiCall("post", "/tables/" + $("#results").data("table") + "/bulk_delete", { rows: JSON.stringify(payload) }, function(resp) {
    if (resp && resp.error) {
      showErrorBanner("Delete failed: " + resp.error);
      return;
    }
    var affected = (resp && resp.rows && resp.rows[0]) ? resp.rows[0][0] : 0;
    if (!affected) {
      showErrorBanner("No rows deleted — they may have changed. Refresh and try again.");
      return;
    }
    if (affected < $rows.length) {
      showErrorBanner("Deleted " + affected + " of " + $rows.length + " rows — some may have changed. Refresh to verify.");
    }
    $rows.remove();
  });
}

// Export the checkbox-selected rows through the server's normal export formatter.
// Rows are POSTed (the selection can be large) by their values; the backend re-selects them by primary key and streams the chosen format as a download.
function exportSelectedRows(format) {
  if ($("#results").data("mode") != "browse") return;

  var $rows = $("#results_body input.row-select-box:checked").closest("tr");
  if (!$rows.length) return;

  var payload = [];
  $rows.each(function() { payload.push(collectRowValues($(this))); });

  var $form = $("<form>", {
    method: "POST",
    action: "api/tables/" + $("#results").data("table") + "/export_rows?format=" + format,
    target: "_blank"
  });
  $("<input>", { type: "hidden", name: "rows", value: JSON.stringify(payload) }).appendTo($form);
  $form.appendTo("body").submit().remove();
}

function startCellEdit($div) {
  if ($("#results").data("mode") != "browse") {
    displayCellValue($div);
    return;
  }
  if ($div.children("textarea").length) return;

  var $td = $div.parent();
  var column = $td.data("name");
  if (column == null) return;

  var original  = cellValue($div);
  var rowValues = collectRowValues($td.closest("tr"));
  // JSON/JSONB cells open pretty-printed for readable multi-line editing.
  var jsonVal   = original === null ? undefined : parseJsonValue(original);
  var isJson    = jsonVal !== undefined;
  var text      = original === null ? "" : (isJson ? JSON.stringify(jsonVal, null, 2) : original);

  var $editor = $("<textarea class='cell-editor' spellcheck='false'></textarea>")
    .attr("rows", Math.min(isJson ? 18 : 8, Math.max(1, text.split("\n").length)))
    .val(text);
  if (isJson) $editor.addClass("cell-editor--json").attr("title", "Ctrl+Enter to save, Esc to cancel");

  $div.addClass("editing").html($editor);
  $editor.focus()[0].select();

  var settled = false;

  function cancel() {
    if (settled) return;
    settled = true;
    renderCellValue($div, original);
  }

  // viaBlur: on blur an invalid-JSON edit is discarded (no stuck editor);
  // an explicit Ctrl+Enter keeps editing so the typo can be fixed.
  function finish(viaBlur) {
    if (settled) return;

    var next = $editor.val();
    if ((original === null && next === "") || next === original) {
      settled = true;
      renderCellValue($div, original);
      return;
    }

    if (isJson) {
      var parsed;
      try {
        parsed = JSON.parse(next);
      } catch (err) {
        if (viaBlur) { settled = true; renderCellValue($div, original); showErrorBanner("Invalid JSON — edit discarded"); return; }
        showErrorBanner("Invalid JSON: " + err.message);
        $editor.focus();
        return;
      }
      var canonical = JSON.stringify(parsed);
      if (canonical === JSON.stringify(jsonVal)) { settled = true; renderCellValue($div, original); return; }
      settled = true;
      saveCellValue($div, column, canonical, false, rowValues, original);
      return;
    }

    settled = true;
    saveCellValue($div, column, next, false, rowValues, original);
  }

  $editor.on("keydown", function(e) {
    if (e.keyCode == 13) {
      // JSON: Enter = newline, Ctrl/Cmd+Enter = save. Plain: Enter = save, Shift+Enter = newline.
      if (isJson) {
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); finish(false); }
      } else if (!e.shiftKey) {
        e.preventDefault();
        finish(false);
      }
    } else if (e.keyCode == 27) {
      e.preventDefault();
      cancel();
    }
  });

  $editor.on("blur", function() { finish(true); });
}

// Theme cycling. Each theme id doubles as the <body> class ("classic" = none). The button shows the active theme; clicking advances to the next one. The choice is persisted in localStorage. A previously stored theme that's no longer offered (e.g. the removed "bios") falls back to classic.
var THEMES = ["classic", "office98"];
var THEME_LABELS = { classic: "Classic", office98: "Office 98" };

function currentTheme() {
  var t = localStorage.getItem("pgweb_theme") || "classic";
  return THEMES.indexOf(t) >= 0 ? t : "classic";
}

function applyTheme() {
  var t = currentTheme();
  $("body").removeClass("office98");
  if (t !== "classic") $("body").addClass(t);
  $("#toggle_theme").text(THEME_LABELS[t]);
}

// ---- JSONB viewer ---------------------------------------------------------

// Parse a cell string into a JSON object/array, or undefined if it isn't one.
function parseJsonValue(s) {
  if (typeof s !== "string") return undefined;
  var t = s.trim();
  if (t === "" || (t[0] !== "{" && t[0] !== "[")) return undefined;
  try {
    var v = JSON.parse(t);
    return (v !== null && typeof v === "object") ? v : undefined;
  } catch (e) { return undefined; }
}

function jtEsc(s) { return jQuery("<div/>").text(s).html(); }

// Recursive, collapsible, syntax-highlighted JSON tree as an HTML string.
function jtRender(v) {
  if (v === null) return '<span class="jt-null">null</span>';
  var t = typeof v;
  if (t === "string")  return '<span class="jt-str">"' + jtEsc(v) + '"</span>';
  if (t === "number")  return '<span class="jt-num">' + v + '</span>';
  if (t === "boolean") return '<span class="jt-bool">' + v + '</span>';
  if (Array.isArray(v)) {
    if (!v.length) return '<span class="jt-punc">[ ]</span>';
    var inner = v.map(function(item, i) {
      return '<div class="jt-row">' + jtRender(item) + (i < v.length - 1 ? '<span class="jt-punc">,</span>' : '') + '</div>';
    }).join("");
    return '<span class="jt-tog" role="button">▾</span><span class="jt-punc">[</span><span class="jt-count" style="display:none">' + v.length + ' items</span>' +
           '<div class="jt-children">' + inner + '</div><span class="jt-punc">]</span>';
  }
  if (t === "object") {
    var keys = Object.keys(v);
    if (!keys.length) return '<span class="jt-punc">{ }</span>';
    var inner = keys.map(function(k, i) {
      return '<div class="jt-row"><span class="jt-key">"' + jtEsc(k) + '"</span><span class="jt-punc">: </span>' +
             jtRender(v[k]) + (i < keys.length - 1 ? '<span class="jt-punc">,</span>' : '') + '</div>';
    }).join("");
    return '<span class="jt-tog" role="button">▾</span><span class="jt-punc">{</span><span class="jt-count" style="display:none">' + keys.length + ' keys</span>' +
           '<div class="jt-children">' + inner + '</div><span class="jt-punc">}</span>';
  }
  return jtEsc(String(v));
}

// Show a cell value in the modal: a JSON tree when it parses as object/array, plain text otherwise.
function showCellModal(value) {
  var $content = $("#content_modal .content");
  var json = parseJsonValue(value);
  if (json !== undefined) {
    $content.addClass("jt-mode").html(jtRender(json));
    $("#content_modal").data("copy", JSON.stringify(json, null, 2));
  } else {
    $content.removeClass("jt-mode").text(value == null ? "" : value);
    $("#content_modal").removeData("copy");
  }
  $("#content_modal").show();
}

// ---- Foreign-key navigation ----------------------------------------------

var fkCache = {};

function fkUnquote(s) {
  s = (s || "").trim();
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') s = s.slice(1, -1).replace(/""/g, '"');
  return s;
}

// Parse FOREIGN KEY definitions from /constraints into { localCol: {table, column} }. Single-column FKs only.
function parseFkMap(data) {
  var map = {};
  if (!data || !data.rows) return map;
  var di = data.columns ? data.columns.indexOf("definition") : 1;
  data.rows.forEach(function(row) {
    var def = row[di];
    if (typeof def !== "string") return;
    var m = def.match(/^FOREIGN KEY \(([^)]+)\) REFERENCES (.+?)\s*\(([^)]+)\)/i);
    if (!m) return;
    var local = m[1].split(",").map(fkUnquote), target = m[3].split(",").map(fkUnquote);
    if (local.length !== 1 || target.length !== 1) return;
    map[local[0]] = { table: m[2].trim().replace(/"/g, ""), column: target[0] };
  });
  return map;
}

function fetchFkMap(table, cb) {
  if (fkCache[table]) { cb(fkCache[table]); return; }
  getTableConstraints(table, function(data) {
    fkCache[table] = (data && !data.error) ? parseFkMap(data) : {};
    cb(fkCache[table]);
  });
}

// Open the FK target table filtered to the referenced row ("col" = value).
function openFkTarget(targetTable, targetColumn, value) {
  var $li = $("#objects li.schema-item").filter(function() {
    return $(this).data("id") === targetTable || $(this).data("name") === targetTable;
  }).first();
  if (!$li.length) { showErrorBanner("Table '" + targetTable + "' not found in the sidebar"); return; }

  currentObject = { name: $li.data("id"), type: $li.data("type") };
  $("#objects li").removeClass("active");
  $li.addClass("active");
  $(".current-page").data("page", 1);
  $(".filters select, .filters input").val("");
  sessionStorage.setItem("tab", "table_content");
  showTableInfo();

  var name  = currentObject.name;
  var where = '"' + targetColumn + '" ' + filterOptions["equal"].replace("DATA", value);
  var opts  = { limit: getRowsLimit(), offset: 0, where: where };
  getTableRows(name, opts, function(data) {
    $("#input").hide();
    $("#body").prop("class", "with-pagination with-rows-query");
    if (rowsEditor) {
      rowsEditor.setValue(buildBrowseQuery(name, opts));
      rowsEditor.clearSelection();
      rowsEditor.resize();
      layoutRowsQuery();
    }
    buildTable(data, null, null, { selectable: true });
    setCurrentTab("table_content");
    updatePaginator(data.pagination);
    $("#results").data("mode", "browse").data("table", name);
    fetchFkMap(name, $.noop);
  });
}

function bindContentModalEvents() {
  var contentModal = document.getElementById("content_modal");

  $(window).on("click", function(e) {
    // Automatically hide the modal on any click outside of the modal window
    if (e.target && !contentModal.contains(e.target)) {
      $("#content_modal").hide();
    }
  });

  $("#content_modal .content-modal-action").on("click", function() {
    switch ($(this).data("action")) {
      case "copy":
        // For a JSON value copy the pretty-printed form, otherwise the raw text.
        var custom = $("#content_modal").data("copy");
        copyToClipboard(custom != null ? custom : $("#content_modal pre").text());
        break;
      case "close":
        $("#content_modal").hide();
        break;
    }
  });

  // Collapse / expand a JSON tree node.
  $("#content_modal").on("click", ".jt-tog", function(e) {
    e.stopPropagation();
    var $t = $(this);
    var collapse = !$t.hasClass("collapsed");
    $t.toggleClass("collapsed", collapse).html(collapse ? "▸" : "▾");
    $t.siblings(".jt-count").toggle(collapse);
    $t.siblings(".jt-children").toggle(!collapse);
  });

  $("#results").on("dblclick", "td > div", function() {
    startCellEdit($(this));
  });

  // Export-selected submenu. 
  $("#results_row_menu").on("click", ".export-parent", function(e) {
    e.preventDefault();
    e.stopPropagation();
  });
  $("#results_row_menu").on("click", "a.export-fmt", function(e) {
    e.preventDefault();
    exportSelectedRows($(this).data("format"));
  });

  // Header "select all": if anything is selected (partial OR full) a click CLEARS everything 
  $("#results_header").on("click", "input.row-select-all", function(e) {
    e.preventDefault();
    var on = $("#results_body input.row-select-box:checked").length === 0;
    $("#results_body input.row-select-box").prop("checked", on);
    $("#results_body input.row-select-box").closest("tr").toggleClass("row-checked", on);
    syncSelectAll();
  });
  // Per-row tick: keep the row highlight + the header box in sync.
  $("#results_body").on("change", "input.row-select-box", function() {
    $(this).closest("tr").toggleClass("row-checked", this.checked);
    syncSelectAll();
  });

  // Esc clears the row selection. Skip when the keystroke comes from a text field (cell editor textarea, query bar, object filter) so it can't steal Esc from the cell edit cancel or a filter reset — those own their own Esc behaviour.
  $(document).on("keydown", function(e) {
    if (e.keyCode != 27) return;
    if ($("#results").data("mode") != "browse") return;
    if (selectedRowCount() === 0) return;
    if ($(e.target).is("input, textarea")) return;
    clearRowSelection();
  });
}

$(document).ready(function() {
  bindInputResizeEvents();
  bindContentModalEvents();

  applyTheme();
  $("#toggle_theme").on("click", function(e) {
    e.preventDefault();
    var next = THEMES[(THEMES.indexOf(currentTheme()) + 1) % THEMES.length];
    localStorage.setItem("pgweb_theme", next);
    applyTheme();
  });

  $("#rows_query_run").on("click", runRowsQuery);

  $("#table_content").on("click",     function() { showTableContent();     });
  $("#table_structure").on("click",   function() { showTableStructure();   });
  $("#table_indexes").on("click",     function() { showTableIndexes();     });
  $("#table_constraints").on("click", function() { showTableConstraints(); });
  $("#table_history").on("click",     function() { showQueryHistory();     });
  $("#table_query").on("click",       function() { showQueryPanel();       });
  $("#table_connection").on("click",  function() { showConnectionPanel();  });
  $("#table_activity").on("click",    function() { showActivityPanel();    });

  $("#run").on("click", function() {
    runQuery();
  });

  $("#explain").on("click", function() {
    runExplain();
  });

  $("#analyze").on("click", function() {
    runAnalyze();
  });

  $("#csv").on("click", function() {
    exportTo("csv");
  });

  $("#json").on("click", function() {
    exportTo("json");
  });

  $("#xml").on("click", function() {
    exportTo("xml");
  });

  $("#results_view").on("click", ".copy", function() {
    copyToClipboard($(this).parent().text());
  });

  // original single-row click highlight (.selected). Independent of the checkbox selection
  // stream — and it must NOT fire for clicks in the checkbox column (the select-all box, a
  // row box, or the cell around them), or it would thrash selection on every tick.
  $("#results").on("click", "tr", function(e) {
    if ($(e.target).closest(".row-select-col").length) return;
    $("#results tr.selected").removeClass("selected");
    $(this).addClass("selected");
  });

  $("#objects").on("click", ".schema-group-title", function(e) {
    $(this).parent().toggleClass("expanded");
  });

  $("#objects").on("click", ".schema-name", function(e) {
    $(this).parent().toggleClass("expanded");
  });

  $("#objects").on("click", "li", function(e) {
    currentObject = {
      name: $(this).data("id"),
      type: $(this).data("type")
    };

    $("#objects li").removeClass("active");
    $(this).addClass("active");
    $(".current-page").data("page", 1);
    $(".filters select, .filters input").val("");

    if (currentObject.type == "function") {
      sessionStorage.setItem("tab", "table_structure");
    } else {
      showTableInfo();
    }

    switch(sessionStorage.getItem("tab")) {
      case "table_content":
        showTableContent();
        break;
      case "table_structure":
        showTableStructure();
        break;
      case "table_constraints":
        showTableConstraints();
        break;
      case "table_indexes":
        showTableIndexes();
        break;
      default:
        showTableContent();
    }
  });

  $("#results").on("click", "a.row-action", function(e) {
    e.preventDefault();

    var action = $(this).data("action");
    var value  = $(this).data("value");

    performRowAction(action, value);
  })

  $("#results").on("click", "th", function(e) {
    if (!$("#table_content").hasClass("selected")) return;
    // Non-data headers (the select-all checkbox column, the action column) have
    // no column name — clicking them must NOT trigger a sort + table re-render
    // (that was wiping the select-all selection the instant it was made).
    if (!$(this).data("name")) return;

    var sortColumn = $(this).data("name");
    var sortOrder  = $(this).data("order") === "ASC" ? "DESC" : "ASC";

    $(this).data("order", sortOrder);
    showTableContent(sortColumn, sortOrder);
  });

  $("#refresh_tables").on("click", function() {
    loadSchemas();
  });

  $("#rows_filter").on("submit", function(e) {
    e.preventDefault();
    $(".current-page").data("page", 1);

    var column = $(this).find("select.column").val();
    var filter = $(this).find("select.filter").val();
    var query  = $.trim($(this).find("input").val());

    if (filter && filterOptions[filter].indexOf("DATA") > 0 && query == "") {
      alert("Please specify filter query");
      return
    }

    showTableContent();
  });

  $(".change-limit").on("click", function() {
    var limit = prompt("Please specify a new rows limit", getRowsLimit());

    if (limit && limit >= 1) {
      $(".current-page").data("page", 1);
      setRowsLimit(limit);
      showTableContent();
    }
  });

  $("select.filter").on("change", function(e) {
    var val = $(this).val();

    if (["null", "not_null"].indexOf(val) >= 0) {
      $(".filters input").hide().val("");
    }
    else {
      $(".filters input").show();
    }
  });

  $("button.reset-filters").on("click", function() {
    $(".filters select, .filters input").val("");
    showTableContent();
  });

  // Automatically prefill the filter if it's not set yet
  $("select.column").on("change", function() {
    if ($("select.filter").val() == "") {
      $("select.filter").val("equal");
      $("#table_filter_value").focus();
    }
  });

  $("#pagination .next-page").on("click", function() {
    var current = $(".current-page").data("page");
    var total   = $(".current-page").data("pages");

    if (total > current) {
      $(".current-page").data("page", current + 1);
      showPaginatedTableContent();

      if (current + 1 == total) {
        $(this).prop("disabled", "disabled");
      }
    }

    if (current > 1) {
      $(".prev-page").prop("disabled", "");
    }
  });

  $("#pagination .prev-page").on("click", function() {
    var current = $(".current-page").data("page");

    if (current > 1) {
      $(".current-page").data("page", current - 1);
      $(".next-page").prop("disabled", "");
      showPaginatedTableContent();
    }

    if (current == 1) {
      $(this).prop("disabled", "disabled");
    }
  });

  $("#current_database").on("click", function(e) {
    apiCall("get", "/databases", {}, function(resp) {
      // Hide maintenance databases we never browse from the switch list.
      if (Array.isArray(resp)) resp = resp.filter(function(d) { return d !== "postgres"; });
      toggleDatabaseSearch();
      enableDatabaseSearch(resp);
    });
  });

  $("#database_search").change(function(e) {
    var current = $("#database_search").typeahead("getActive");
    if (current && current == $("#database_search").val()) {
      apiCall("post", "/switchdb", { db: current }, function(resp) {
        if (resp.error) {
          alert(resp.error);
          return;
        };
        window.location.reload();
      });
    };
  });

  $("#edit_connection").on("click", function() {
    if (connected) {
      $("#close_connection_window").show();
    }

    showConnectionSettings();
  });

  $("#close_connection").on("click", function() {
    if (!confirm("Are you sure you want to disconnect?")) return;

    disconnect(function() {
      showConnectionSettings();
      resetTable();
      $("#close_connection_window").hide();
    });
  });

  $("#close_connection_window").on("click", function() {
    $("#connection_window").hide();
  });

  $("#connection_url").on("change", function() {
    if ($(this).val().indexOf("localhost") != -1) {
      $("#connection_ssl").val("disable");
    }
  });

  $("#pg_host").on("change", function() {
    var value = $(this).val();

    if (value.indexOf("localhost") != -1 || value.indexOf("127.0.0.1") != -1) {
      $("#connection_ssl").val("disable");
    }
  });

  $(".connection-group-switch button").on("click", function() {
    $(".connection-group-switch button").removeClass("active");
    $(this).addClass("active");

    switch($(this).attr("data")) {
      case "scheme":
        $(".connection-scheme-group").show();
        $(".connection-standard-group").hide();
        $(".connection-ssh-group").hide();
        return;
      case "standard":
        $(".connection-scheme-group").hide();
        $(".connection-standard-group").show();
        $(".connection-ssh-group").hide();
        return;
      case "ssh":
        $(".connection-scheme-group").hide();
        $(".connection-standard-group").show();
        $(".connection-ssh-group").show();
        return;
    }
  });

  $("#connection_bookmarks").on("change", function(e) {
    var selection = $(this).val();

    var inputs = [
      $("#connection_form input[type='text']"),
      $("#connection_form input[type='password']"),
      $("#connection_ssl")
    ];

    inputs.forEach(function(selector) {
      selector.val("").prop("disabled", selection == "" ? "" : "disabled");
    });
  });

  $("#connection_form").on("submit", function(e) {
    e.preventDefault();

    var button = $(this).find("button.open-connection");
    var params = {};
    var bookmarkID = $.trim($("#connection_bookmarks").val());

    if (bookmarkID != "") {
      params["bookmark_id"] = $("#connection_bookmarks").val();
    }
    else {
      params.url = getConnectionString();
      if (params.url.length == 0) {
        return;
      }

      if ($(".connection-group-switch button.active").attr("data") == "ssh") {
        params["ssh"]              = 1
        params["ssh_host"]         = $("#ssh_host").val();
        params["ssh_port"]         = $("#ssh_port").val();
        params["ssh_user"]         = $("#ssh_user").val();
        params["ssh_password"]     = $("#ssh_password").val();
        params["ssh_key"]          = $("#ssh_key").val();
        params["ssh_key_password"] = $("#ssh_key_password").val()
      }
    }

    $("#connection_error").hide();
    button.prop("disabled", true).text("Please wait...");

    apiCall("post", "/connect", params, function(resp) {
      button.prop("disabled", false).text("Connect");

      if (resp.error) {
        connected = false;
        $("#connection_error").text(resp.error).show();
      }
      else {
        connected = true;
        loadSchemas();
        loadLocalQueries();

        $("#connection_window").hide();
        $("#current_database").text(resp.current_database);
        $("#main").show();
      }
    });
  });

  initEditor();
  addShortcutTooltips();
  bindDatabaseObjectsFilter();

  // Set session from the url
  var reqUrl = new URL(window.location);
  var sessionId = reqUrl.searchParams.get("session");

  if (sessionId && sessionId != "") {
    sessionStorage.setItem("session_id", sessionId);
    window.history.pushState({}, document.title, window.location.pathname);
  }

  getInfo(function(resp) {
    if (resp.error) {
      alert("Unable to fetch app info: " + resp.error + ". Please reload the browser page.");
      return;
    }

    appInfo = resp.app;
    appFeatures = resp.features;

    getConnection(function(resp) {
      if (resp.error) {
        connected = false;
        showConnectionSettings();
        $(".connection-actions").show();
        return;
      }

      connected = true;
      loadSchemas();
      loadLocalQueries();

      $("#current_database").text(resp.current_database);
      $("#main").show();

      if (!appFeatures.session_lock) {
        $(".connection-actions").show();
      }
    });
  });
});

