import { chromium, type Browser } from 'playwright';
export async function launchBrowser(headed = true): Promise<Browser> {
  return chromium.launch({ headless: !headed, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false, executablePath: process.env.SEMANTIC_RECORDER_CHROMIUM_PATH || undefined });
}
