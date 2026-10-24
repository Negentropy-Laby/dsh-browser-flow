// SPDX-License-Identifier: Apache-2.0
package graphcore

import "errors"

type SemanticNode struct {
	ID     string         `json:"id"`
	Kind   string         `json:"kind"`
	Source string         `json:"source"`
	Data   map[string]any `json:"data"`
}
type SemanticEdge struct {
	ID       string `json:"id"`
	From     string `json:"from"`
	To       string `json:"to"`
	Relation string `json:"relation"`
}
type SemanticUpdate struct {
	ID    string `json:"id"`
	State string `json:"state"`
}
type SemanticChange struct {
	Nodes     []SemanticNode   `json:"nodes"`
	Edges     []SemanticEdge   `json:"edges"`
	Updates   []SemanticUpdate `json:"updates"`
	Round     bool             `json:"round"`
	Completed bool             `json:"completed"`
}

func liveNode(n *Node) bool {
	if n.Kind != "intent" {
		return false
	}
	if n.Data["status"] == "pending" || n.Data["status"] == "unknown_outcome" {
		return true
	}
	s := n.Data["state"]
	return s == "open" || s == "running" || s == "paused"
}
func initialSemanticState(n SemanticNode) bool {
	switch n.Kind {
	case "goal", "intent":
		return n.Data["state"] == "open"
	case "hint":
		return n.Data["state"] == "active"
	case "fact":
		if n.Source == "host" {
			return n.Data["state"] == "origin"
		}
		return n.Data["state"] == "confirmed"
	}
	return false
}
func semanticTransition(n *Node, state string) bool {
	if n.Kind == "goal" {
		return state == "met" && (n.Data["state"] == "open" || n.Data["state"] == "met")
	}
	if n.Kind != "intent" {
		return false
	}
	if n.Data["state"] == "open" {
		return state == "running"
	}
	return n.Data["state"] == "running" && (state == "done" || state == "blocked" || state == "exhausted" || state == "stopped")
}
func (p *Projection) applySemantic(event Event) error {
	c := event.Semantic
	if c == nil || len(c.Nodes) > 128 || len(c.Edges) > 256 || len(c.Updates) > 128 {
		return errors.New("invalid_semantic_event")
	}
	for _, n := range c.Nodes {
		if n.ID == "" || p.index[n.ID] != nil {
			return errors.New("duplicate_semantic_node")
		}
		switch n.Kind {
		case "goal", "intent", "fact", "hint":
		default:
			return errors.New("invalid_semantic_kind")
		}
		if n.Source != "agent" && n.Source != "host" && n.Source != "user_declared" {
			return errors.New("invalid_semantic_source")
		}
		for k := range n.Data {
			switch k {
			case "state", "confidence", "priority", "mandatory":
			default:
				return errors.New("invalid_semantic_data")
			}
		}
		if !initialSemanticState(n) {
			return errors.New("invalid_semantic_state")
		}
		data := map[string]any{}
		for k, v := range n.Data {
			data[k] = v
		}
		p.add(n.ID, n.Kind, n.Source, event.Seq, event.Run, data)
	}
	for _, u := range c.Updates {
		n := p.index[u.ID]
		if n == nil || n.run != event.Run {
			return errors.New("invalid_semantic_update")
		}
		if !semanticTransition(n, u.State) {
			return errors.New("invalid_semantic_state")
		}
		n.Data["state"] = u.State
	}
	for _, e := range c.Edges {
		from, to := p.index[e.From], p.index[e.To]
		if from == nil || to == nil || from.run != event.Run || to.run != event.Run {
			return errors.New("invalid_semantic_edge")
		}
		p.edge(e.ID, e.From, e.To, e.Relation, event.Seq)
	}
	if c.Completed {
		for _, n := range p.Nodes {
			if n.run == event.Run && n.Kind == "intent" && n.Data["state"] == "open" {
				n.Data["state"] = "stopped"
			}
		}
	}
	if c.Round {
		p.Round++
	}
	return nil
}
