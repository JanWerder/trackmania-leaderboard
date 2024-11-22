import { collectYearData } from './collector.js';
import { generateWrappedReport } from './wrapped.js';

await collectYearData();

const report = await generateWrappedReport();
await Bun.write('wrapped.html', report); 