// SPDX-License-Identifier: Apache-2.0
package graphcore

import (
	"errors"
	"regexp"
	"sort"
)

// ResourceDescriptor is allowlisted Host metadata, never an authorization token.
type ResourceDescriptor struct {
	ID             string `json:"id"`
	Basis          string `json:"basis"`
	SnapshotKind   string `json:"snapshotKind"`
	GroupingReason string `json:"groupingReason"`
}

// Resource groups immutable snapshots inside one complete run and asset kind.
type Resource struct {
	ID             string   `json:"id"`
	Kind           string   `json:"kind"`
	Run            Scope    `json:"run"`
	Basis          string   `json:"basis"`
	GroupingReason string   `json:"groupingReason"`
	Snapshots      []string `json:"snapshots"`
}

// Anchor retains the exact edge and both endpoint runs, including historical links.
type Anchor struct {
	Edge
	Run     Scope `json:"run"`
	FromRun Scope `json:"fromRun"`
	ToRun   Scope `json:"toRun"`
}

var resourceRef = regexp.MustCompile(`^resource-[a-f0-9]{64}$`)

func assetKind(kind string) bool {
	switch kind {
	case "page", "file", "unit_check", "import_result", "evidence":
		return true
	}
	return false
}
func (p *Projection) buildResources() error {
	p.Resources = []Resource{}
	p.Anchors = []Anchor{}
	byID := map[string]int{}
	for _, e := range p.Input.Events {
		if e.Type != "asset" {
			continue
		}
		d := e.Resource
		// Direct kernel clients without new metadata retain independent old snapshots.
		if d == nil {
			d = &ResourceDescriptor{ID: "resource-" + hashJSON([]any{e.Run, e.Kind, e.ID}), Basis: "unavailable", SnapshotKind: "unknown", GroupingReason: "reliable_identity_unavailable"}
		}
		if !resourceRef.MatchString(d.ID) {
			return errors.New("invalid_resource")
		}
		switch d.Basis {
		case "document_instance", "source_path", "independent", "unavailable":
		default:
			return errors.New("invalid_resource")
		}
		if (d.Basis == "document_instance" && (e.Kind != "page" || (d.SnapshotKind != "observation" && d.SnapshotKind != "context"))) || (d.Basis == "source_path" && (e.Kind != "file" || d.SnapshotKind != "file")) {
			return errors.New("invalid_resource")
		}
		if i, ok := byID[d.ID]; ok {
			r := &p.Resources[i]
			if r.Run != e.Run || r.Kind != e.Kind || r.Basis != d.Basis || r.GroupingReason != d.GroupingReason || d.Basis == "independent" || d.Basis == "unavailable" {
				return errors.New("invalid_resource_scope")
			}
			r.Snapshots = append(r.Snapshots, e.ID)
		} else {
			byID[d.ID] = len(p.Resources)
			p.Resources = append(p.Resources, Resource{d.ID, e.Kind, e.Run, d.Basis, d.GroupingReason, []string{e.ID}})
		}
	}
	for _, edge := range p.Edges {
		from, to := p.index[edge.From], p.index[edge.To]
		if assetKind(from.Kind) == assetKind(to.Kind) {
			continue
		}
		run := p.Input.Scope
		if edge.SourceSeq > 0 && edge.SourceSeq <= int64(len(p.Input.Events)) {
			run = p.Input.Events[edge.SourceSeq-1].Run
		}
		p.Anchors = append(p.Anchors, Anchor{edge, run, from.run, to.run})
	}
	return nil
}
func (p *Projection) graphSummary() map[string]any {
	exploration := len(p.Digests)
	snapshots := 0
	refs := []string{}
	for _, n := range p.Nodes {
		if assetKind(n.Kind) {
			snapshots++
		} else {
			exploration++
		}
	}
	for _, r := range p.Resources {
		refs = append(refs, r.ID)
	}
	if len(refs) > 8 {
		refs = refs[len(refs)-8:]
	}
	return map[string]any{"assets": map[string]any{"details": "graph:assets", "resources": len(p.Resources), "snapshots": snapshots, "recentResources": refs}, "exploration": map[string]any{"details": "graph:exploration", "nodes": exploration, "anchors": len(p.Anchors)}}
}

// Connected traces follow explicit edges only. Sharing a goal is not causality.
func (p *Projection) connected(seeds []string) map[string]bool {
	seen := map[string]bool{}
	adjacent := map[string][]string{}
	for _, e := range p.Edges {
		if e.Relation == "attempts" {
			continue
		}
		adjacent[e.From] = append(adjacent[e.From], e.To)
		adjacent[e.To] = append(adjacent[e.To], e.From)
	}
	queue := append([]string{}, seeds...)
	for len(queue) > 0 {
		id := queue[0]
		queue = queue[1:]
		if seen[id] {
			continue
		}
		seen[id] = true
		for _, other := range adjacent[id] {
			if !seen[other] {
				queue = append(queue, other)
			}
		}
	}
	return seen
}
func (p *Projection) dualDetail(ref string) (any, error) {
	nodes := []*Node{}
	relations := []Edge{}
	if ref == "graph:assets" || ref == "graph:exploration" {
		assets := ref == "graph:assets"
		for _, n := range p.Nodes {
			if assetKind(n.Kind) == assets {
				nodes = append(nodes, n)
			}
		}
		for _, e := range p.Edges {
			if assetKind(p.index[e.From].Kind) == assets && assetKind(p.index[e.To].Kind) == assets {
				relations = append(relations, e)
			}
		}
		if assets {
			return map[string]any{"resources": p.Resources, "snapshots": nodes, "relations": relations, "anchors": p.Anchors}, nil
		}
		for _, d := range p.Digests {
			nodes = append(nodes, &Node{ID: d.ID, TaskID: p.Input.Scope.TaskID, Kind: "digest", Source: "derived", Data: map[string]any{"signature": d.Signature}})
			for _, id := range d.Members {
				relations = append(relations, Edge{ID: d.ID + ":" + id, TaskID: p.Input.Scope.TaskID, From: d.ID, To: id, Relation: "covers"})
			}
		}
		return map[string]any{"nodes": nodes, "relations": relations, "anchors": p.Anchors, "digests": p.Digests}, nil
	}
	for _, r := range p.Resources {
		if r.ID == ref {
			seen := p.connected(r.Snapshots)
			anchors := []Anchor{}
			exploration := []string{}
			evidence := []string{}
			for _, id := range r.Snapshots {
				nodes = append(nodes, p.index[id])
			}
			for _, e := range p.Edges {
				if seen[e.From] && seen[e.To] && assetKind(p.index[e.From].Kind) && assetKind(p.index[e.To].Kind) {
					relations = append(relations, e)
				}
			}
			for _, a := range p.Anchors {
				if seen[a.From] && seen[a.To] {
					anchors = append(anchors, a)
				}
			}
			for id := range seen {
				n := p.index[id]
				if !assetKind(n.Kind) {
					exploration = append(exploration, id)
				}
				if n.Kind == "evidence" {
					evidence = append(evidence, id)
				}
			}
			sort.Strings(exploration)
			sort.Strings(evidence)
			return map[string]any{"resource": r, "snapshots": nodes, "relations": relations, "anchors": anchors, "explorationRefs": exploration, "evidenceRefs": evidence}, nil
		}
	}
	return nil, errors.New("stale_reference")
}
