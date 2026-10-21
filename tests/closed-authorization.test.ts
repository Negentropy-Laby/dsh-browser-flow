import assert from 'node:assert/strict'
import { it } from 'node:test'
import { BrowserFlowService } from '../src/index.ts'
import { resolveConfig } from '../src/config.ts'

it('returns an HTTP refusal when authorization is called after unload', async () => {
  const service = new BrowserFlowService({}, resolveConfig(undefined))
  await service.close()
  const response = await service.handleAuthorize(new Request('http://fixture.test/api/browser-flow/authorize', {method:'POST',body:'{}'}))
  assert.ok(response instanceof Response)
  assert.equal(response.status,409)
  const body: unknown = await response.json()
  assert.deepEqual(body,{ok:false,error:{code:'connection_stale',message:'the service was unloaded; control is suspended'}})
  assert.equal(service.state.leaseCount(),0)
})
