import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DerivedCache} from '../src/derived-cache.ts'
test('derived cache bounds total payload and count, uses LRU, and clears only the revised owner',()=>{
 const cache=new DerivedCache(100)
 cache.set('a','one','A',60);cache.set('b','two','B',30);assert.equal(cache.get('a'),'A')
 cache.set('c','two','C',30);assert.equal(cache.get('b'),undefined);assert.equal(cache.get('a'),'A')
 cache.set('large','one','too large',101);assert.equal(cache.get('large'),undefined)
 cache.clear('one');assert.equal(cache.get('a'),undefined);assert.equal(cache.get('c'),'C')
 cache.clear();for(let i=0;i<33;i++)cache.set(String(i),'one',i,1)
 assert.equal(cache.get('0'),undefined);assert.equal(cache.get('32'),32)
})
