/**
 * Reads one mandate and prints what the LLM found, writing nothing: to check the quality of the readings.
 * `bun run mandate:read <mandate url> <start YYYY-MM-DD> [end YYYY-MM-DD]`. Needs `OPENROUTER_API_KEY` and poppler.
 */
import { checkMandateData } from '../../domain/mandate.ts';
import { config } from '../config.ts';
import { OpenRouterMandateExtractor } from './openrouter-mandate-extractor.ts';
import { PdfMandateFetcher } from './pdf-mandate-fetcher.ts';

const [url, startDate, end] = Bun.argv.slice(2);
if (!url || !startDate || !config.openRouterApiKey) {
  console.error('Usage: OPENROUTER_API_KEY=… bun run mandate:read <mandate url> <start YYYY-MM-DD> [end YYYY-MM-DD]');
  process.exit(1);
}
const endDate = end ?? startDate;

const started = performance.now();
const document = await new PdfMandateFetcher().fetch(url);
console.log(
  `${document.pageCount} page(s), ${document.pageImages.length} sent as images, text: ${document.text ? 'yes' : 'no (scanned)'}`,
);
const competition = { title: '(inconnu)', town: '(inconnue)', startDate, endDate };
const { answer, model, costUsd } = await new OpenRouterMandateExtractor(
  config.openRouterApiKey,
  config.mandateModel,
).extract(document, competition);
const check = checkMandateData(answer, competition);
console.log(JSON.stringify(check.ok ? check.data : { refused: check.problems, answer }, null, 2));
console.log(`${model}, $${(costUsd ?? 0).toFixed(5)}, ${Math.round(performance.now() - started) / 1000} s`);
