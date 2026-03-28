import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join, extname, basename } from 'path';
import { randomUUID } from 'crypto';
import type { AuraPlugin, PluginContext } from '../core/plugin-bus.js';

export interface Document {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  category: DocumentCategory;
  size: number;
  text: string;
  ocrText?: string;
  tags: string[];
  expiryDate?: string;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export type DocumentCategory = 'medical' | 'financial' | 'legal' | 'personal' | 'work' | 'education' | 'insurance' | 'travel' | 'other';

interface DocumentConfig {
  vaultPath: string;
  maxFileSizeMb: number;
  ocrEnabled: boolean;
  autoCategorizse: boolean;
  expiryAlertDays: number;
}

export class DocumentPlugin implements AuraPlugin {
  name = 'documents';
  version = '0.3.0';
  private ctx!: PluginContext;
  private config!: DocumentConfig;
  private vaultPath!: string;

  async onLoad(ctx: PluginContext): Promise<void> {
    this.ctx = ctx;
    this.config = {
      vaultPath: './data/vault',
      maxFileSizeMb: 50,
      ocrEnabled: true,
      autoCategorizse: true,
      expiryAlertDays: 30,
      ...ctx.config as Record<string, unknown>,
    } as DocumentConfig;

    this.vaultPath = this.config.vaultPath;
    mkdirSync(this.vaultPath, { recursive: true });

    ctx.logger.info('Document vault plugin loaded');
  }

  async onActivate(): Promise<void> {
    // Daily expiry check at 9 AM
    this.ctx.schedule('0 9 * * *', async () => {
      await this.checkExpiries();
    });

    this.ctx.logger.info(`Document vault activated — ${this.listDocuments().length} documents stored`);
  }

  async onDeactivate(): Promise<void> {
    this.ctx.logger.info('Document vault deactivated');
  }

  // --- Document Ingestion ---

  async ingestFile(filePath: string, originalName?: string): Promise<Document> {
    const name = originalName ?? basename(filePath);
    const ext = extname(name).toLowerCase();
    const mimeType = this.getMimeType(ext);
    const id = randomUUID();
    const filename = `${id}${ext}`;

    // Copy to vault
    const vaultFilePath = join(this.vaultPath, filename);
    const content = readFileSync(filePath);

    const sizeMb = content.length / (1024 * 1024);
    if (sizeMb > this.config.maxFileSizeMb) {
      throw new Error(`File too large: ${sizeMb.toFixed(1)}MB (max: ${this.config.maxFileSizeMb}MB)`);
    }

    writeFileSync(vaultFilePath, content);

    // Extract text
    let text = '';
    let ocrText: string | undefined;

    if (ext === '.pdf') {
      text = this.extractPdfText(vaultFilePath);
      if (!text.trim() && this.config.ocrEnabled) {
        ocrText = this.ocrFile(vaultFilePath);
        text = ocrText;
      }
    } else if (['.jpg', '.jpeg', '.png', '.tiff', '.bmp', '.gif'].includes(ext)) {
      if (this.config.ocrEnabled) {
        ocrText = this.ocrFile(vaultFilePath);
        text = ocrText ?? '';
      }
    } else if (['.txt', '.md', '.csv', '.json', '.xml'].includes(ext)) {
      text = readFileSync(vaultFilePath, 'utf-8');
    }

    // Auto-categorize
    const category = this.config.autoCategorizse ? this.categorizeDocument(name, text) : 'other';

    // Detect expiry dates
    const expiryDate = this.detectExpiry(text);

    // Build document record
    const doc: Document = {
      id,
      filename,
      originalName: name,
      mimeType,
      category,
      size: content.length,
      text: text.slice(0, 10000), // Store first 10K chars
      ocrText: ocrText?.slice(0, 10000),
      tags: this.autoTag(name, text, category),
      expiryDate,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {},
    };

    // Store in DB
    this.ctx.storage.set('documents', id, doc, {
      category,
      filename: name,
      expiryDate: expiryDate ?? '',
    });

    this.ctx.emit('ingested', { id, name, category });
    this.ctx.logger.info(`Document ingested: ${name} → ${category}`);

    return doc;
  }

  // --- OCR ---

  ocrFile(filePath: string): string {
    try {
      const ext = extname(filePath).toLowerCase();

      if (ext === '.pdf') {
        // Convert PDF to images first, then OCR
        const tmpDir = `/tmp/aura-ocr-${Date.now()}`;
        mkdirSync(tmpDir, { recursive: true });

        try {
          execSync(`pdftoppm -png -r 300 "${filePath}" "${tmpDir}/page"`, { timeout: 30000 });
          const pages = readdirSync(tmpDir).filter(f => f.endsWith('.png')).sort();
          const texts: string[] = [];

          for (const page of pages) {
            const pageText = execSync(`tesseract "${join(tmpDir, page)}" - --oem 3 --psm 6 2>/dev/null`, {
              timeout: 30000,
              encoding: 'utf-8',
            });
            texts.push(pageText.trim());
          }

          // Cleanup
          for (const f of readdirSync(tmpDir)) unlinkSync(join(tmpDir, f));

          return texts.join('\n\n--- Page Break ---\n\n');
        } finally {
          try { execSync(`rm -rf "${tmpDir}"`); } catch { /* ignore */ }
        }
      }

      // Direct OCR for images
      const result = execSync(`tesseract "${filePath}" - --oem 3 --psm 6 2>/dev/null`, {
        timeout: 30000,
        encoding: 'utf-8',
      });
      return result.trim();
    } catch (err) {
      this.ctx.logger.error(`OCR failed for ${filePath}: ${err}`);
      return '';
    }
  }

  // --- Text Extraction ---

  private extractPdfText(filePath: string): string {
    try {
      const result = execSync(`pdftotext "${filePath}" - 2>/dev/null`, {
        timeout: 15000,
        encoding: 'utf-8',
      });
      return result.trim();
    } catch {
      return '';
    }
  }

  // --- Categorization ---

  private categorizeDocument(name: string, text: string): DocumentCategory {
    const combined = `${name} ${text}`.toLowerCase();

    const categories: Array<{ keywords: string[]; category: DocumentCategory }> = [
      { keywords: ['prescription', 'diagnosis', 'hospital', 'medical', 'doctor', 'lab report', 'blood test', 'x-ray', 'mri', 'ct scan', 'discharge summary', 'health', 'patient'], category: 'medical' },
      { keywords: ['insurance', 'policy', 'premium', 'claim', 'coverage', 'nominee', 'sum assured', 'maturity'], category: 'insurance' },
      { keywords: ['invoice', 'receipt', 'tax', 'itr', 'gst', 'pan', 'bank statement', 'salary slip', 'form 16', 'balance sheet', 'profit loss', 'audit'], category: 'financial' },
      { keywords: ['agreement', 'contract', 'lease', 'deed', 'affidavit', 'power of attorney', 'notary', 'court', 'legal notice', 'will', 'testament'], category: 'legal' },
      { keywords: ['passport', 'visa', 'boarding pass', 'ticket', 'itinerary', 'travel', 'flight', 'hotel booking'], category: 'travel' },
      { keywords: ['certificate', 'degree', 'marksheet', 'transcript', 'diploma', 'course', 'university', 'school', 'admission', 'enrollment'], category: 'education' },
      { keywords: ['offer letter', 'appointment', 'resignation', 'experience certificate', 'payslip', 'appraisal', 'project', 'meeting notes', 'company'], category: 'work' },
      { keywords: ['aadhaar', 'aadhar', 'voter id', 'driving license', 'ration card', 'birth certificate', 'marriage certificate', 'photo id'], category: 'personal' },
    ];

    let bestCategory: DocumentCategory = 'other';
    let bestScore = 0;

    for (const { keywords, category } of categories) {
      const score = keywords.filter(k => combined.includes(k)).length;
      if (score > bestScore) {
        bestScore = score;
        bestCategory = category;
      }
    }

    return bestCategory;
  }

  // --- Auto-tagging ---

  private autoTag(name: string, text: string, category: DocumentCategory): string[] {
    const tags: string[] = [category];
    const combined = `${name} ${text}`.toLowerCase();

    // Year detection
    const yearMatch = combined.match(/\b(20[12]\d)\b/);
    if (yearMatch) tags.push(yearMatch[1]);

    // Amount detection
    if (/₹|rs\.?\s*[\d,]+|\$\s*[\d,]+/.test(combined)) tags.push('has-amount');

    // Name detection from filename
    const nameClean = name.replace(/[._-]/g, ' ').replace(/\.\w+$/, '');
    if (nameClean.length > 3) tags.push(nameClean.toLowerCase().trim());

    return [...new Set(tags)];
  }

  // --- Expiry Detection ---

  private detectExpiry(text: string): string | undefined {
    const lower = text.toLowerCase();

    // Look for expiry/validity patterns
    const expiryPatterns = [
      /(?:valid|expir|renew|due|maturity)\s*(?:till|until|upto|by|date|on)?\s*[:\-]?\s*(\d{1,2}[\s/.-]\w+[\s/.-]\d{2,4})/i,
      /(?:expiry|validity|renewal)\s*(?:date)?\s*[:\-]?\s*(\d{1,2}[\s/.-]\d{1,2}[\s/.-]\d{2,4})/i,
    ];

    for (const pattern of expiryPatterns) {
      const match = lower.match(pattern);
      if (match) return match[1];
    }

    return undefined;
  }

  // --- Expiry Alerts ---

  async checkExpiries(): Promise<void> {
    const docs = this.listDocuments();
    const now = new Date();
    const alertDate = new Date(now.getTime() + this.config.expiryAlertDays * 24 * 60 * 60 * 1000);
    const alerts: string[] = [];

    for (const doc of docs) {
      if (!doc.expiryDate) continue;

      try {
        const expiry = new Date(doc.expiryDate);
        if (isNaN(expiry.getTime())) continue;

        if (expiry <= now) {
          alerts.push(`🚨 <b>EXPIRED:</b> ${doc.originalName} (${doc.category}) — expired ${doc.expiryDate}`);
        } else if (expiry <= alertDate) {
          const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          alerts.push(`⚠️ ${doc.originalName} (${doc.category}) — expires in ${daysLeft} days`);
        }
      } catch {
        // Invalid date, skip
      }
    }

    if (alerts.length > 0) {
      await this.ctx.notify(`📄 <b>Document Expiry Alerts</b>\n\n${alerts.join('\n')}`);
    }
  }

  // --- Query ---

  listDocuments(filter?: { category?: DocumentCategory; tag?: string }): Document[] {
    const all = this.ctx.storage.sqlite.list('documents');

    return all
      .map(row => JSON.parse(row.value) as Document)
      .filter(doc => {
        if (filter?.category && doc.category !== filter.category) return false;
        if (filter?.tag && !doc.tags.includes(filter.tag)) return false;
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getDocument(id: string): Document | null {
    return this.ctx.storage.get<Document>('documents', id) ?? null;
  }

  searchDocuments(query: string): Document[] {
    const docs = this.listDocuments();
    const q = query.toLowerCase();

    return docs.filter(doc =>
      doc.originalName.toLowerCase().includes(q) ||
      doc.text.toLowerCase().includes(q) ||
      doc.tags.some(t => t.includes(q)) ||
      doc.category.includes(q)
    );
  }

  deleteDocument(id: string): boolean {
    const doc = this.getDocument(id);
    if (!doc) return false;

    // Delete file
    const filePath = join(this.vaultPath, doc.filename);
    if (existsSync(filePath)) unlinkSync(filePath);

    // Delete from DB
    this.ctx.storage.delete('documents', id);
    this.ctx.logger.info(`Document deleted: ${doc.originalName}`);
    return true;
  }

  // --- Summary ---

  getSummary(): string {
    const docs = this.listDocuments();
    if (docs.length === 0) return '📄 Document vault is empty. Send files to store them.';

    const byCategory = new Map<string, number>();
    let totalSize = 0;
    let expiringCount = 0;

    const now = new Date();
    const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    for (const doc of docs) {
      byCategory.set(doc.category, (byCategory.get(doc.category) ?? 0) + 1);
      totalSize += doc.size;

      if (doc.expiryDate) {
        try {
          const exp = new Date(doc.expiryDate);
          if (exp <= thirtyDays) expiringCount++;
        } catch { /* skip */ }
      }
    }

    const categoryLines = Array.from(byCategory.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([cat, count]) => `  • ${cat}: ${count}`);

    const sizeMb = (totalSize / (1024 * 1024)).toFixed(1);

    let summary = `📄 <b>Document Vault</b>\n\n`;
    summary += `Total: ${docs.length} documents (${sizeMb} MB)\n\n`;
    summary += categoryLines.join('\n');

    if (expiringCount > 0) {
      summary += `\n\n⚠️ ${expiringCount} document(s) expiring within 30 days`;
    }

    return summary;
  }

  // --- Helpers ---

  private getMimeType(ext: string): string {
    const types: Record<string, string> = {
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.tiff': 'image/tiff', '.tif': 'image/tiff',
      '.bmp': 'image/bmp',
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.csv': 'text/csv',
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
    return types[ext] ?? 'application/octet-stream';
  }
}
