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

// UpdateTableRow updates a single column of a row identified by its primary key. The new value and key values are passed as bound parameters and cast to their own column types, so the statement is safe against injection and type mismatches. Editing requires the table to expose a primary key.
func (client *Client) UpdateTableRow(table string, opts UpdateRowOptions) (*Result, error) {
	schema, name := getSchemaAndTable(table)

	meta, err := client.TableColumnsMeta(table)
	if err != nil {
		return nil, err
	}

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

	setClause := fmt.Sprintf(`"%s" = NULL`, opts.Column)
	if !opts.IsNull {
		args = append(args, opts.Value)
		setClause = fmt.Sprintf(`"%s" = $%d::%s`, opts.Column, len(args), types[opts.Column])
	}

	conditions := make([]string, 0, len(primaryKey))
	for _, col := range primaryKey {
		val, ok := opts.RowValues[col]
		if !ok || val == nil {
			return nil, fmt.Errorf("missing primary key value for column %q", col)
		}
		args = append(args, *val)
		conditions = append(conditions, fmt.Sprintf(`"%s" = $%d::%s`, col, len(args), types[col]))
	}

	sql := fmt.Sprintf(
		`UPDATE "%s"."%s" SET %s WHERE %s`,
		schema, name, setClause, strings.Join(conditions, " AND "),
	)

	return client.query(sql, args...)
}
