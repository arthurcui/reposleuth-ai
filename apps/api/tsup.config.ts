import { defineConfig } from 'tsup';

export default defineConfig({ noExternal: ['@reposleuth/shared'], removeNodeProtocol: false });
