package client

import (
	"fmt"
	"strings"

	"github.com/sosedoff/pgweb/pkg/statements"
)

// UpdateRowOptions describes a single-cell update. The target row is located by its primary key, whose values are taken from RowValues (the original row as displayed). Value is ignored when IsNull is set.
type UpdateRowOptions struct {
	Column    string
	Value     string
	IsNull    bool
	RowValues map[string]*string
}

// TableColumnsMeta returns each column's name, type and whether it is part of the table's primary key.
func (client *Client) TableColumnsMeta(table string) (*Result, error) {
	schema, name := getSchemaAndTable(table)
	return client.query(statements.TableColumnsMeta, schema, name)
}

// parseColumnsMeta splits a TableColumnsMeta result into a column->type map and the ordered list of primary-key columns.
func parseColumnsMeta(meta *Result) (map[string]string, []string) {
	types := map[string]string{}
	primaryKey := []string{}
	for _, row := range meta.Rows {
		col, _ := row[0].(string)
		colType, _ := row[1].(string)
		isPrimary, _ := row[2].(bool)

		types[col] = colType
		if isPrimary {
			primaryKey = append(primaryKey, col)
		}
	}
	return types, primaryKey
}

// buildPrimaryKeyMatch builds the parameterized WHERE conditions that match a single row by its primary key, reading key values from rowValues. Placeholder numbering starts at startIdx; values are cast to their own column types. Column names go through pgQuoteIdent so a name containing `"` can't break out of the identifier.
func buildPrimaryKeyMatch(types map[string]string, primaryKey []string, rowValues map[string]*string, startIdx int) (string, []interface{}, error) {
	conds := make([]string, 0, len(primaryKey))
	args := make([]interface{}, 0, len(primaryKey))
	for i, col := range primaryKey {
		val, ok := rowValues[col]
		if !ok || val == nil {
			return "", nil, fmt.Errorf("missing primary key value for column %q", col)
		}
		args = append(args, *val)
		conds = append(conds, fmt.Sprintf(`%s = $%d::%s`, pgQuoteIdent(col), startIdx+i, types[col]))
	}
	return strings.Join(conds, " AND "), args, nil
}

// UpdateTableRow updates a single column of a row identified by its primary key. The new value and key values are passed as bound parameters and cast to their own column types, so the statement is safe against injection and type mismatches. Editing requires the table to expose a primary key.
func (client *Client) UpdateTableRow(table string, opts UpdateRowOptions) (*Result, error) {
	schema, name := getSchemaAndTable(table)

	meta, err := client.TableColumnsMeta(table)
	if err != nil {
		return nil, err
	}

	types, primaryKey := parseColumnsMeta(meta)
	if len(types) == 0 {
		return nil, fmt.Errorf("table %q does not exist", table)
	}
	if _, ok := types[opts.Column]; !ok {
		return nil, fmt.Errorf("unknown column %q", opts.Column)
	}
	if len(primaryKey) == 0 {
		return nil, fmt.Errorf("cannot edit rows: table %q has no primary key", table)
	}

	args := []interface{}{}
	setClause := fmt.Sprintf(`%s = NULL`, pgQuoteIdent(opts.Column))
	if !opts.IsNull {
		args = append(args, opts.Value)
		setClause = fmt.Sprintf(`%s = $%d::%s`, pgQuoteIdent(opts.Column), len(args), types[opts.Column])
	}

	where, whereArgs, err := buildPrimaryKeyMatch(types, primaryKey, opts.RowValues, len(args)+1)
	if err != nil {
		return nil, err
	}
	args = append(args, whereArgs...)

	sql := fmt.Sprintf(`UPDATE %s.%s SET %s WHERE %s`, pgQuoteIdent(schema), pgQuoteIdent(name), setClause, where)
	return client.query(sql, args...)
}

// DeleteTableRow deletes a row identified by its primary key, read from rowValues (the original row as displayed). Key values are bound and cast to their column types. Deleting requires the table to expose a primary key.
func (client *Client) DeleteTableRow(table string, rowValues map[string]*string) (*Result, error) {
	schema, name := getSchemaAndTable(table)

	meta, err := client.TableColumnsMeta(table)
	if err != nil {
		return nil, err
	}

	types, primaryKey := parseColumnsMeta(meta)
	if len(types) == 0 {
		return nil, fmt.Errorf("table %q does not exist", table)
	}
	if len(primaryKey) == 0 {
		return nil, fmt.Errorf("cannot delete rows: table %q has no primary key", table)
	}

	where, args, err := buildPrimaryKeyMatch(types, primaryKey, rowValues, 1)
	if err != nil {
		return nil, err
	}

	sql := fmt.Sprintf(`DELETE FROM %s.%s WHERE %s`, pgQuoteIdent(schema), pgQuoteIdent(name), where)
	return client.query(sql, args...)
}

// DeleteTableRows deletes several rows in a single statement, each located by its primary key read from its rowValues map. Every row's key values are bound and cast to their column types, and the per-row matches are OR-ed together so the whole delete runs (and counts affected rows) atomically. Deleting requires the table to expose a primary key.
func (client *Client) DeleteTableRows(table string, rows []map[string]*string) (*Result, error) {
	schema, name := getSchemaAndTable(table)

	if len(rows) == 0 {
		return nil, fmt.Errorf("no rows to delete")
	}

	meta, err := client.TableColumnsMeta(table)
	if err != nil {
		return nil, err
	}

	types, primaryKey := parseColumnsMeta(meta)
	if len(types) == 0 {
		return nil, fmt.Errorf("table %q does not exist", table)
	}
	if len(primaryKey) == 0 {
		return nil, fmt.Errorf("cannot delete rows: table %q has no primary key", table)
	}

	conds := make([]string, 0, len(rows))
	args := []interface{}{}
	for _, rowValues := range rows {
		where, whereArgs, err := buildPrimaryKeyMatch(types, primaryKey, rowValues, len(args)+1)
		if err != nil {
			return nil, err
		}
		conds = append(conds, "("+where+")")
		args = append(args, whereArgs...)
	}

	sql := fmt.Sprintf(`DELETE FROM %s.%s WHERE %s`, pgQuoteIdent(schema), pgQuoteIdent(name), strings.Join(conds, " OR "))
	return client.query(sql, args...)
}

// SelectTableRows returns the full rows identified by the given primary keys (same PK-matching as DeleteTableRows, but a SELECT *), so a selection of rows can be exported through the normal result formatters. Requires a primary key.
func (client *Client) SelectTableRows(table string, rows []map[string]*string) (*Result, error) {
	schema, name := getSchemaAndTable(table)

	if len(rows) == 0 {
		return nil, fmt.Errorf("no rows to export")
	}

	meta, err := client.TableColumnsMeta(table)
	if err != nil {
		return nil, err
	}

	types, primaryKey := parseColumnsMeta(meta)
	if len(types) == 0 {
		return nil, fmt.Errorf("table %q does not exist", table)
	}
	if len(primaryKey) == 0 {
		return nil, fmt.Errorf("cannot export rows: table %q has no primary key", table)
	}

	conds := make([]string, 0, len(rows))
	args := []interface{}{}
	for _, rowValues := range rows {
		where, whereArgs, err := buildPrimaryKeyMatch(types, primaryKey, rowValues, len(args)+1)
		if err != nil {
			return nil, err
		}
		conds = append(conds, "("+where+")")
		args = append(args, whereArgs...)
	}

	sql := fmt.Sprintf(`SELECT * FROM %s.%s WHERE %s`, pgQuoteIdent(schema), pgQuoteIdent(name), strings.Join(conds, " OR "))
	return client.query(sql, args...)
}
