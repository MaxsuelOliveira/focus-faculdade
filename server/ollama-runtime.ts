import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

/** Instância opcional do aplicativo; nunca encerra um serviço que já estava rodando. */
export class OllamaRuntime {
  private child?: ChildProcess;
  async start() {
    if (process.env.FOCUS_MANAGED_OLLAMA !== 'true') return;
    const url = new URL(config.ollamaUrl);
    if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:' || url.port !== '11436')
      throw new Error('Ollama gerenciado exige http://127.0.0.1:11436.');
    if (await this.ready()) return;
    const executable = path.join(
      process.env.LOCALAPPDATA || '',
      'Programs',
      'Ollama',
      'ollama.exe',
    );
    if (!existsSync(executable)) {
      console.warn('Ollama não encontrado. Configure um provedor na interface.');
      return;
    }
    this.child = spawn(executable, ['serve'], {
      env: { ...process.env, OLLAMA_HOST: url.host },
      windowsHide: true,
      stdio: 'ignore',
    });
    this.child.on('error', () => console.warn('Não foi possível iniciar o Ollama local.'));
    for (let attempt = 0; attempt < 25; attempt++) {
      if (await this.ready()) return;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    console.warn(
      'Ollama local ainda indisponível. Atualize os modelos na interface para tentar novamente.',
    );
  }
  private async ready() {
    try {
      return (
        await fetch(new URL('/api/version', config.ollamaUrl), { signal: AbortSignal.timeout(700) })
      ).ok;
    } catch {
      return false;
    }
  }
  stop() {
    this.child?.kill();
    this.child = undefined;
  }
}
