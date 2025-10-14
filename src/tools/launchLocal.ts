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

async function start() {
  const args = process.argv.slice(2);

  // Detect engine: --engine=puppeteer or --engine=playwright (default: playwright)
  const engineArgIndex = args.findIndex((arg) => arg.startsWith('--engine='));
  let engine = 'playwright'; // default
  if (engineArgIndex !== -1) {
    engine = args[engineArgIndex].split('=')[1];
    args.splice(engineArgIndex, 1); // Remove from args
  }

  // Dynamic import based on engine
  let getPage: any;
  if (engine === 'puppeteer') {
    ({ getPage } = await import('./browserPuppeteer'));
  } else {
    ({ getPage } = await import('./browserPlaywright'));
  }

  const headless = args.includes('--headless');
  const devtools = args.includes('--devtools');

  const { page } = await getPage({
    headless,
    devtools,
    viewport: null,
    args,
  });

  page.on('load', () => {
    const debug = process.env['DEBUG'] || '*';

    page.evaluate((debug: string) => {
      localStorage.setItem('debug', debug);
    }, debug);
  });
}
start();
