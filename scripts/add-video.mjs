import 'dotenv/config';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { readSecret } from './secret.mjs';

const options = {
  server: { type: 'string' }, email: { type: 'string' }, course: { type: 'string' },
  module: { type: 'string' }, title: { type: 'string' }, duration: { type: 'string' },
  description: { type: 'string' }, url: { type: 'string' }, file: { type: 'string' },
  list: { type: 'boolean' }, help: { type: 'boolean' },
};

async function main() {
  const { values } = parseArgs({ options });
  if (values.help) {
    console.log('npm run video:add -- --email EMAIL --list\nnpm run video:add -- --email EMAIL --course COURSE --module MODULE --title TITLE (--file FILE | --url HTTPS_URL)');
    return;
  }
  const endpoint = new URL(values.server || process.env.PBS_PORTAL_URL || 'http://127.0.0.1:3000');
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname))) {
    throw new Error('Use HTTPS to sign into a remote PBS server.');
  }
  if (endpoint.username || endpoint.password) throw new Error('Enter the server URL without credentials.');
  const email = values.email || process.env.PBS_ADMIN_EMAIL;
  if (!email) throw new Error('Pass --email or set PBS_ADMIN_EMAIL.');
  if (!values.list && (!values.course || !values.module || !values.title || Boolean(values.file) === Boolean(values.url))) {
    throw new Error('Pass --course, --module, --title, and exactly one of --file or --url. Use --list to find identifiers.');
  }
  const password = await readSecret('PBS_ADMIN_PASSWORD', 'Administrator password');
  let cookie = '';
  const request = async (route, options = {}) => {
    const headers = { 'X-PBS-Request': '1', ...(cookie ? { Cookie: cookie } : {}), ...options.headers };
    const result = await fetch(new URL(route, endpoint), { ...options, headers, redirect: 'error' });
    if (!result.ok) {
      const data = await result.json().catch(() => ({}));
      throw new Error(data.error || `PBS returned HTTP ${result.status}.`);
    }
    return result;
  };
  const login = await request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: email, password, role: 'admin', remember: false }),
  });
  cookie = login.headers.get('set-cookie')?.split(';')[0] || '';
  if (!cookie) throw new Error('The server did not return a session.');
  try {
    const { courses } = await (await request('/api/admin/workspace')).json();
    if (values.list) {
      for (const course of courses) {
        console.log(`${course.id}  ${course.title}`);
        for (const module of course.modules) console.log(`  ${module.id}  ${module.title}`);
      }
      return;
    }
    const course = select(courses, values.course, 'course');
    const module = select(course.modules, values.module, 'module');
    const route = `/api/admin/courses/${encodeURIComponent(course.id)}/modules/${encodeURIComponent(module.id)}/lessons`;
    const details = { title: values.title, duration: values.duration || '', description: values.description || '' };
    let result;
    if (values.file) {
      const file = await stat(values.file);
      const ext = path.extname(values.file).toLowerCase();
      const type = ext === '.mp4' ? 'video/mp4' : ext === '.webm' ? 'video/webm' : '';
      if (!file.isFile() || !type) throw new Error('Choose an MP4 or WebM file.');
      const uploadRequest = await request(`${route}/upload`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contentType: type, size: file.size }),
      });
      const upload = await uploadRequest.json();
      const fileOptions = { headers: { 'Content-Type': type, 'Content-Length': String(file.size) },
        body: createReadStream(values.file), duplex: 'half' };
      if (upload.storage === 'blob') {
        const uploaded = await fetch(upload.url, { ...fileOptions, method: 'PUT', redirect: 'error' });
        if (!uploaded.ok) throw new Error(`Video upload failed with HTTP ${uploaded.status}.`);
        result = await request(`${route}/upload/${encodeURIComponent(upload.uploadId)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(details),
        });
      } else {
        result = await request(`${route}/file?${new URLSearchParams(details)}`, { ...fileOptions, method: 'POST' });
      }
    } else {
      result = await request(route, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...details, url: values.url }),
      });
    }
    const { id } = await result.json();
    console.log(`Added ${values.title} to ${course.title} / ${module.title} (${id}).`);
  } finally {
    await request('/api/auth/logout', { method: 'POST' }).catch(() => {});
  }
}

function select(items, term, label) {
  const matches = items.filter(item => item.id === term || item.title.toLowerCase() === term.toLowerCase());
  if (matches.length !== 1) throw new Error(`Choose a unique ${label} using --list.`);
  return matches[0];
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
