import { expect, test } from 'bun:test';

import { answerJson } from './openrouter-mandate-extractor.ts';

test('reads the JSON of an answer, even wrapped in a code fence or a sentence', () => {
  const json = { departures: [], prices: [{ audience: 'all', departures: 1, amountEuros: 10 }] };
  expect(answerJson(JSON.stringify(json))).toEqual(json);
  expect(answerJson('```json\n' + JSON.stringify(json, null, 2) + '\n```')).toEqual(json);
  expect(answerJson(`Voici les informations du mandat : ${JSON.stringify(json)} Bonne journée.`)).toEqual(json);
});

test('gives nothing for an answer with no JSON object, or one cut in the middle', () => {
  expect(answerJson('Je ne peux pas lire ce document.')).toBeUndefined();
  expect(answerJson('{"departures": [{"date": "2026-10-10", "label": "Mat')).toBeUndefined();
});
