import { readFileSync } from 'fs';
import { parseProfitabilityExcelFile } from '../server/utils/profitabilityImport';

async function testParser() {
  try {
    console.log('📖 Reading Excel file...');
    const filePath = 'attached_assets/Z-отчеты_1762175853535.xlsx';
    const buffer = readFileSync(filePath);
    
    console.log('🔍 Parsing file...');
    const result = parseProfitabilityExcelFile(buffer, {
      maxChecksPerDay: 10000
    });
    
    console.log('\n✅ Parsing successful!');
    console.log('📊 Results:');
    console.log('  - Sheet name:', result.sheetName);
    console.log('  - Header row index:', result.headerRowIndex);
    console.log('  - Records parsed:', result.records.length);
    console.log('  - Rows processed:', result.rowsProcessed);
    console.log('  - Skipped rows:', result.skippedRows);
    console.log('  - Duplicates:', result.duplicateCount);
    console.log('  - Period start:', result.periodStart?.toISOString().split('T')[0]);
    console.log('  - Period end:', result.periodEnd?.toISOString().split('T')[0]);
    
    if (result.errors.length > 0) {
      console.log('\n⚠️ Errors:', result.errors.length);
      console.log('First 5 errors:');
      result.errors.slice(0, 5).forEach(err => {
        console.log(`  Row ${err.rowNumber}: ${err.message}`);
      });
    }
    
    if (result.warnings.length > 0) {
      console.log('\n⚠️ Warnings:', result.warnings.length);
      result.warnings.slice(0, 5).forEach(warn => {
        console.log(`  - ${warn}`);
      });
    }
    
    console.log('\n📝 Detected columns:');
    Object.entries(result.detectedColumns).forEach(([key, value]) => {
      if (value) {
        console.log(`  ${key}: "${value}"`);
      }
    });
    
    if (result.records.length > 0) {
      console.log('\n📋 Sample records (first 3):');
      result.records.slice(0, 3).forEach((record, idx) => {
        console.log(`\nRecord ${idx + 1}:`);
        console.log('  Date:', record.reportDate.toISOString().split('T')[0]);
        console.log('  Shift:', record.shiftNumber);
        console.log('  Income checks:', record.incomeChecks);
        console.log('  Cash income:', record.cashIncome);
        console.log('  Cashless income:', record.cashlessIncome);
        console.log('  Returns:', record.cashReturn + record.cashlessReturn);
        console.log('  Corrections:', record.correctionCash + record.correctionCashless);
      });
    }
    
  } catch (error: any) {
    console.error('\n❌ Parsing failed:', error.message);
    if (error.details) {
      console.error('Details:', JSON.stringify(error.details, null, 2));
    }
    console.error('Stack:', error.stack);
  }
}

testParser();
