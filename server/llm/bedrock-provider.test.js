import { test, expect } from 'bun:test';
import { BedrockProvider } from './bedrock-provider.js';

test('streamChat yields text deltas then done on a clean stream', async () => {
  const provider = new BedrockProvider({ region: 'us-east-1', modelId: 'fake-model' });
  provider.client.send = async () => ({
    stream: (async function* () {
      yield { contentBlockDelta: { delta: { text: '你好' } } };
      yield { contentBlockDelta: { delta: { text: '呀' } } };
      yield { messageStop: {} };
    })(),
  });

  const out = [];
  for await (const ev of provider.streamChat({ system: 's', messages: [], intents: [] })) {
    out.push(ev);
  }

  expect(out).toEqual([
    { type: 'text_delta', delta: '你好' },
    { type: 'text_delta', delta: '呀' },
    { type: 'done' },
  ]);
});

test('streamChat yields text deltas that precede a mid-stream fault, then throws', async () => {
  const provider = new BedrockProvider({ region: 'us-east-1', modelId: 'fake-model' });
  provider.client.send = async () => ({
    stream: (async function* () {
      yield { contentBlockDelta: { delta: { text: '你好' } } };
      yield { contentBlockDelta: { delta: { text: '呀' } } };
      yield { throttlingException: { message: 'rate limited' } };
      // Should never be reached; if the generator kept going after the fault, this
      // would show up in `out` and the test would catch the regression.
      yield { contentBlockDelta: { delta: { text: '不应该出现' } } };
      yield { messageStop: {} };
    })(),
  });

  const out = [];
  let thrown = null;
  try {
    for await (const ev of provider.streamChat({ system: 's', messages: [], intents: [] })) {
      out.push(ev);
    }
  } catch (err) {
    thrown = err;
  }

  expect(out).toEqual([
    { type: 'text_delta', delta: '你好' },
    { type: 'text_delta', delta: '呀' },
  ]);
  expect(thrown).toEqual({ message: 'rate limited' });
});

test('streamChat throws on other fault event shapes too (internalServerException, validationException, ...)', async () => {
  const faultKeys = [
    'internalServerException',
    'modelStreamErrorException',
    'validationException',
    'serviceUnavailableException',
  ];

  for (const key of faultKeys) {
    const provider = new BedrockProvider({ region: 'us-east-1', modelId: 'fake-model' });
    provider.client.send = async () => ({
      stream: (async function* () {
        yield { [key]: { message: `boom from ${key}` } };
      })(),
    });

    let thrown = null;
    try {
      for await (const _ev of provider.streamChat({ system: 's', messages: [], intents: [] })) {
        // no-op
      }
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toEqual({ message: `boom from ${key}` });
  }
});
