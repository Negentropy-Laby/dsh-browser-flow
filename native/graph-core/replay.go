// SPDX-License-Identifier: Apache-2.0
package graphcore

import "context"

// replayState tracks only contributions affected by the current event. Each
// live intent owns sets, so removing a cyclic branch cannot keep itself hot.
type replayState struct {
	parents, children map[int64][]int64
	live              map[int64]*contribution
	owners            map[int64]map[int64]bool
	hot               map[int64]int
	dirty             map[int64]bool
	nodes, edges      int
	visits            int
}
type contribution struct{ ancestors, children map[int64]bool }

func newReplay() *replayState {
	return &replayState{parents: map[int64][]int64{}, children: map[int64][]int64{}, live: map[int64]*contribution{}, owners: map[int64]map[int64]bool{}, hot: map[int64]int{}, dirty: map[int64]bool{}}
}
func (r *replayState) mark(id int64, delta int) {
	r.hot[id] += delta
	r.dirty[id] = true
	if r.hot[id] == 0 {
		delete(r.hot, id)
	}
}
func (r *replayState) expand(ctx context.Context, root, start int64) error {
	c := r.live[root]
	stack := []int64{start}
	for len(stack) > 0 {
		if err := ctx.Err(); err != nil {
			return err
		}
		id := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		r.visits++
		if c.ancestors[id] {
			continue
		}
		c.ancestors[id] = true
		if r.owners[id] == nil {
			r.owners[id] = map[int64]bool{}
		}
		r.owners[id][root] = true
		if !c.children[id] {
			r.mark(id, 1)
		}
		stack = append(stack, r.parents[id]...)
	}
	return nil
}
func (r *replayState) activate(ctx context.Context, id int64) error {
	c := &contribution{ancestors: map[int64]bool{}, children: map[int64]bool{}}
	r.live[id] = c
	if err := r.expand(ctx, id, id); err != nil {
		return err
	}
	for _, child := range r.children[id] {
		if !c.children[child] {
			c.children[child] = true
			if !c.ancestors[child] {
				r.mark(child, 1)
			}
		}
	}
	return nil
}
func (r *replayState) settle(id int64) {
	c := r.live[id]
	if c == nil {
		return
	}
	for key := range c.ancestors {
		r.visits++
		r.mark(key, -1)
		delete(r.owners[key], id)
		if len(r.owners[key]) == 0 {
			delete(r.owners, key)
		}
	}
	for key := range c.children {
		if !c.ancestors[key] {
			r.mark(key, -1)
		}
	}
	delete(r.live, id)
}
func (r *replayState) edge(ctx context.Context, from, to int64) error {
	r.parents[to] = append(r.parents[to], from)
	r.children[from] = append(r.children[from], to)
	if c := r.live[from]; c != nil && !c.children[to] {
		c.children[to] = true
		if !c.ancestors[to] {
			r.mark(to, 1)
		}
	}
	// Expansion may add ownership to other nodes; never iterate a map being
	// extended when a cycle reaches the edge's destination again.
	roots := make([]int64, 0, len(r.owners[to]))
	for id := range r.owners[to] {
		roots = append(roots, id)
	}
	for _, id := range roots {
		if err := r.expand(ctx, id, from); err != nil {
			return err
		}
	}
	return nil
}
func (r *replayState) apply(ctx context.Context, p *Projection, event Event, stamps map[int64]*int64, protected map[string]bool) error {
	for ; r.nodes < len(p.Nodes); r.nodes++ {
		n := p.Nodes[r.nodes]
		r.dirty[n.key] = true
		if n.Kind == "intent" && n.Data["status"] == "pending" {
			if err := r.activate(ctx, n.key); err != nil {
				return err
			}
		}
	}
	for ; r.edges < len(p.Edges); r.edges++ {
		e := p.Edges[r.edges]
		from, to := p.index[e.From].key, p.index[e.To].key
		switch e.Relation {
		case "attempts", "records":
			from, to = to, from
		case "yields":
		default:
			continue
		}
		if err := r.edge(ctx, from, to); err != nil {
			return err
		}
	}
	if event.Type == "receipt" && event.Outcome != "unknown_outcome" {
		r.settle(p.index[event.ID].key)
	}
	// Only final event state changes stamps; temporary contributions while a
	// receipt is added do not break continuous coldness within that event.
	for key := range r.dirty {
		r.visits++
		n := p.Nodes[key-1]
		cold := (n.Kind == "intent" || n.Kind == "receipt") && r.hot[key] == 0 && !protected[n.ID]
		if cold {
			if stamps[key] == nil {
				v := p.Round
				stamps[key] = &v
			}
		} else {
			delete(stamps, key)
		}
	}
	clear(r.dirty)
	return ctx.Err()
}
