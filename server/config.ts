import 'dotenv/config';
import { parse } from 'dotenv';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
const localEnv = existsSync('.env') ? parse(readFileSync('.env')) : {};
export const config = {
  port: Number(process.env.PORT || 4317),
  dataDir: path.resolve(process.env.DATA_DIR || 'data'),
  loginUrl: process.env.URL_LOGIN || 'https://faculdadefocus.jacad.com.br/aluno-v2/login',
  courseUrl:
    process.env.AVA_COURSE_URL || 'https://graduacao.faculdadefocus.edu.br/course/view.php?id=8683',
  // USERNAME já existe no Windows. O login acadêmico deve vir do arquivo ou de FOCUS_USERNAME.
  username: process.env.FOCUS_USERNAME || localEnv.USERNAME || '',
  password: process.env.FOCUS_PASSWORD || localEnv.PASSWORD || '',
  ollamaUrl: process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
  ollamaNumGpu:
    process.env.OLLAMA_NUM_GPU === undefined ? undefined : Number(process.env.OLLAMA_NUM_GPU),
  openaiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || '',
};
