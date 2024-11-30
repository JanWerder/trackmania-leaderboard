import { collectYearData } from './collector.js';
import { generateWrappedReport } from './wrapped.js';

const args = process.argv.slice(2);
const mode = args[0]?.toLowerCase();
const currentYear = new Date().getFullYear();

switch (mode) {
    case 'generate':
        console.log(`Generating wrapped report from existing database for ${currentYear}...`);
        const report = await generateWrappedReport();
        await Bun.write(`wrapped_${currentYear}.html`, report);
        console.log('Report generated successfully!');
        break;

    case undefined:
    case 'full':
        console.log(`Collecting ${currentYear} data...`);
        await collectYearData();
        console.log('Generating wrapped report...');
        const fullReport = await generateWrappedReport();
        await Bun.write(`wrapped_${currentYear}.html`, fullReport);
        console.log('Collection and report generation completed successfully!');
        break;

    default:
        console.error('Invalid mode. Use "generate" for report generation only, or no parameter/full for complete collection and generation.');
        process.exit(1);
} 