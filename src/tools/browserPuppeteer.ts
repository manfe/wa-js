/*!
 * Copyright 2021 WPPConnect Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import FileType from 'file-type';
import * as fs from 'fs';
import * as path from 'path';
import * as puppeteer from 'puppeteer';

export const URL = 'https://web.whatsapp.com/';

type LaunchArguments = {
  headless?: boolean;
  devtools?: boolean;
  viewport?: { width: number; height: number } | null;
  args?: string[];
};

export async function preparePage(page: puppeteer.Page) {
  // Bypass CSP to allow script injection
  await page.setBypassCSP(true);

  // Block crashlogs and telemetry
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const requestUrl = request.url();
    if (
      requestUrl.includes('crashlogs.whatsapp.net') ||
      requestUrl.includes('dit.whatsapp.net/deidentified_telemetry')
    ) {
      return request.abort();
    }
    return request.continue();
  });

  // Disable service workers
  await page.evaluateOnNewDocument(() => {
    // Remove existent service worker
    navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => {
        for (const registration of registrations) {
          registration.unregister();
        }
      })
      .catch(() => null);

    // Disable service worker registration
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    navigator.serviceWorker.register = new Promise(() => {});

    setInterval(() => {
      window.onerror = console.error;
      window.onunhandledrejection = console.error;
    }, 500);
  });
}

export async function injectWAScript(page: puppeteer.Page) {
  // Inject WA.js script
  const scriptPath = path.resolve(__dirname, '../../dist/wppconnect-wa.js');
  if (!fs.existsSync(scriptPath)) {
    throw new Error(
      `WA.js script not found at: ${scriptPath}\nPlease run 'npm run build:prd' first.`
    );
  }

  await page.addScriptTag({
    path: scriptPath,
  });
  console.log('WA.js injected successfully from:', scriptPath);

  // Load media files if they exist
  const mediaPath = path.resolve(__dirname, '../../media/');
  if (!fs.existsSync(mediaPath)) {
    return;
  }

  const mediaFiles = fs.readdirSync(mediaPath);
  for (const filename of mediaFiles) {
    const filePath = path.join(mediaPath, filename);
    const content = fs.readFileSync(filePath, {
      encoding: 'base64',
    });

    const mime = await FileType.fromFile(filePath);

    const base64 = `data:${
      mime?.mime || 'application/octet-stream'
    };base64,${content}`;

    await page.evaluate(
      (filename, base64) => {
        (window as any).media = (window as any).media || {};
        (window as any).media[filename] = base64;
      },
      filename,
      base64
    );
  }
}

export async function getPage(options?: LaunchArguments) {
  let userDataDir = path.resolve(__dirname, '../../userDataDir');
  if (Array.isArray(options?.args)) {
    const index = options?.args.findIndex((a) =>
      a.startsWith('--user-data-dir')
    );
    if (typeof index === 'number' && index > -1) {
      const param = options?.args[index];
      options?.args.splice(index, 1);
      userDataDir = param?.split('=')[1] || userDataDir;
    }
  }

  const browser = await puppeteer.launch({
    headless: options?.headless || false,
    devtools: options?.devtools || false,
    userDataDir,
    args: [
      '--start-maximized', // Start browser maximized
      ...(options?.args || []),
    ],
  });

  const pages = await browser.pages();
  const page = pages.length ? pages[0] : await browser.newPage();

  // Set viewport to null for full screen (or use a large viewport)
  if (options?.viewport === null) {
    // Set to null to disable fixed viewport and use full window size
    await page.setViewport(null as any);
  } else if (options?.viewport) {
    await page.setViewport(options.viewport);
  } else {
    // Default: use a large viewport or null for fullscreen
    await page.setViewport(null as any);
  }

  await preparePage(page);

  // Navigate and inject script
  (async () => {
    try {
      console.log('Navigating to WhatsApp Web...');
      await page.goto(URL, {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      });
      console.log('WhatsApp Web loaded');

      // Wait a bit for the page to be ready
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Inject WA.js after page loads
      console.log('Injecting WA.js...');
      await injectWAScript(page);

      try {
        console.log('Waiting for WPP to be ready...');
        await page.waitForFunction(() => (window as any).WPP?.isReady, {
          timeout: 120000,
        });

        const version = await page.evaluate(
          () => (window as any).Debug?.VERSION
        );
        if (version) {
          console.log('WhatsApp Version: ', version);
        }
        console.log('WPP is ready!');
      } catch (error) {
        console.warn('Failed to initialize WPP:', error);
      }
    } catch (error) {
      console.error('Error during initialization:', error);
    }
  })();

  return { browser, page };
}
