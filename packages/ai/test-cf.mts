import { createAiProviders } from './src/index.ts';
import { getServerEnv } from '@openscroll/config';

const env = getServerEnv();
const providers = createAiProviders(env);
const result = await providers.embedding.embed(['testo di prova']);
console.log('embedding length', result.embeddings[0]?.length);
console.log('model', result.model);
