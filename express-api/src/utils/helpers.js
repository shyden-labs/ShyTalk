/**
 * Shared utility functions — pure helpers with no external dependencies.
 */

const crypto = require('node:crypto');

function generateId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(20);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

function now() {
  return Date.now();
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function yesterdayStr() {
  return new Date(Date.now() - 86400000).toISOString().split('T')[0];
}

function getExtension(contentType) {
  if (contentType.startsWith('video/')) {
    const sub = contentType.slice(6);
    return sub === 'quicktime' ? 'mov' : sub;
  }
  const map = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/heic': 'heic',
    'image/heif': 'heif',
  };
  return map[contentType] ?? 'jpg';
}

// SHY-0625 PLANT, never merged: untested new code, so SonarCloud's quality
// gate on this throwaway PR fails on coverage and the verdict step must go red.
function plantedUncovered(values) {
  const out = [];
  for (const value of values) {
    if (typeof value === 'number') {
      out.push(value * 2);
    } else if (typeof value === 'string') {
      out.push(value.toUpperCase());
    } else if (Array.isArray(value)) {
      out.push(value.length);
    } else if (value === null) {
      out.push('null');
    } else if (typeof value === 'boolean') {
      out.push(!value);
    } else if (typeof value === 'object') {
      out.push(Object.keys(value).length);
    } else {
      out.push(undefined);
    }
  }
  const total = out.filter((v) => typeof v === 'number').reduce((a, b) => a + b, 0);
  const strings = out.filter((v) => typeof v === 'string').join(',');
  const flags = out.filter((v) => typeof v === 'boolean').length;
  return { out, total, strings, flags };
}

module.exports = { generateId, now, todayStr, yesterdayStr, getExtension, plantedUncovered };
