package client

import (
	"time"

	"github.com/sosedoff/pgweb/pkg/statements"
)

// DiagramColumn is a single column rendered inside a table card on the schema diagram.
type DiagramColumn struct {
	Name      string `json:"name" db:"name"`
	Type      string `json:"type" db:"type"`
	IsPrimary bool   `json:"is_primary" db:"is_primary"`
	IsForeign bool   `json:"is_foreign" db:"is_foreign"`
}

// DiagramTable is a table card: its name plus the ordered list of its columns.
type DiagramTable struct {
	Name    string          `json:"name"`
	Columns []DiagramColumn `json:"columns"`
}

// DiagramEdge is a single foreign-key relationship (one column pair) between two tables.
type DiagramEdge struct {
	Name         string `json:"name" db:"name"`
	SourceTable  string `json:"source_table" db:"source_table"`
	SourceColumn string `json:"source_column" db:"source_column"`
	TargetTable  string `json:"target_table" db:"target_table"`
	TargetColumn string `json:"target_column" db:"target_column"`
}

// SchemaDiagram is the full graph for one schema consumed by the visual diagram view.
type SchemaDiagram struct {
	Schema string         `json:"schema"`
	Tables []DiagramTable `json:"tables"`
	Edges  []DiagramEdge  `json:"edges"`
}

// diagramColumnRow is the flat scan target for the columns query before grouping by table.
type diagramColumnRow struct {
	TableName string `db:"table_name"`
	Name      string `db:"name"`
	Type      string `db:"type"`
	IsPrimary bool   `db:"is_primary"`
	IsForeign bool   `db:"is_foreign"`
}

// SchemaDiagram returns every base table in the schema with its columns plus all foreign-key edges, ready to render as an ER diagram. Read-only catalog SELECTs.
func (client *Client) SchemaDiagram(schema string) (*SchemaDiagram, error) {
	if client.db == nil {
		return nil, nil
	}
	if schema == "" {
		schema = "public"
	}

	defer func() {
		client.lastQueryTime = time.Now().UTC()
	}()

	ctx, cancel := client.context()
	defer cancel()

	var colRows []diagramColumnRow
	if err := client.db.SelectContext(ctx, &colRows, statements.DiagramColumns, schema); err != nil {
		return nil, err
	}

	var edges []DiagramEdge
	if err := client.db.SelectContext(ctx, &edges, statements.DiagramEdges, schema); err != nil {
		return nil, err
	}
	if edges == nil {
		edges = []DiagramEdge{}
	}

	// Group columns into table cards, preserving the query's table + column order.
	tables := []DiagramTable{}
	index := map[string]int{}
	for _, r := range colRows {
		i, ok := index[r.TableName]
		if !ok {
			i = len(tables)
			index[r.TableName] = i
			tables = append(tables, DiagramTable{Name: r.TableName, Columns: []DiagramColumn{}})
		}
		tables[i].Columns = append(tables[i].Columns, DiagramColumn{
			Name:      r.Name,
			Type:      r.Type,
			IsPrimary: r.IsPrimary,
			IsForeign: r.IsForeign,
		})
	}

	return &SchemaDiagram{Schema: schema, Tables: tables, Edges: edges}, nil
}
