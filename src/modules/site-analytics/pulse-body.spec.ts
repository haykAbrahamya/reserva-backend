import { PassThrough } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pulseBodyReader } from './pulse-body';

/** Feed `chunks` through the reader as a request; resolve with what the route would see. */
function read(chunks: string[] | 'error', opts: { method?: string; limit?: number } = {}) {
  const req = Object.assign(new PassThrough(), {
    method: opts.method ?? 'POST',
    body: undefined as unknown,
  });
  return new Promise<{ body: unknown; nextCalls: number }>((resolve) => {
    let nextCalls = 0;
    pulseBodyReader(opts.limit)(req as unknown as IncomingMessage, {} as ServerResponse, () => {
      nextCalls++;
      // Let any duplicate settle surface before resolving.
      setImmediate(() => resolve({ body: req.body, nextCalls }));
    });
    if (chunks === 'error') req.destroy(new Error('client aborted'));
    else {
      for (const c of chunks) req.write(c);
      req.end();
    }
  });
}

describe('pulseBodyReader', () => {
  it('hands the route the raw text body', async () => {
    expect(await read(['AQAB', 'AgME'])).toEqual({ body: 'AQABAgME', nextCalls: 1 });
  });

  it('reads an empty body as an empty string', async () => {
    expect(await read([])).toEqual({ body: '', nextCalls: 1 });
  });

  it('turns an oversize body into an empty one (the route then answers 204)', async () => {
    expect(await read(['x'.repeat(10), 'y'.repeat(10)], { limit: 15 })).toEqual({
      body: '',
      nextCalls: 1,
    });
    expect(await read(['x'.repeat(15)], { limit: 15 })).toEqual({
      body: 'x'.repeat(15),
      nextCalls: 1,
    });
  });

  it('survives a broken stream', async () => {
    expect(await read('error')).toEqual({ body: '', nextCalls: 1 });
  });

  it('leaves other methods alone', async () => {
    expect(await read(['ignored'], { method: 'OPTIONS' })).toEqual({
      body: undefined,
      nextCalls: 1,
    });
  });
});
