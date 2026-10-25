/** Configures the API bundle and includes shared workspace code in the build. */
import { defineConfig } from 'tsup';

export default defineConfig({ noExternal: ['@reposleuth/shared'], removeNodeProtocol: false });
