import type { Plugin } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Guarded build-time compatibility patch; never edit installed dependencies. */
export function transformersLargeFiles(): Plugin {
	return {
		name: 'transformers-large-files',
		setup(builder) {
			builder.onLoad({ filter: /transformers\.web\.js$/ }, (args) => {
				let source = readFileSync(args.path, 'utf8');
				const reader
					= /async function readResponse\(response, progress_callback, expectedSize\) \{[\s\S]*?\n\}\n(?=function isBlobURL)/;
				const cache = /new Response\(\s*\/\*\* @type \{any\} \*\/\s*result,/;
				const core
					= 'const bufferOrPathPromise = getCoreModelFile(pretrained_model_name_or_path, fileName, options, suffix);';
				if (!reader.test(source) || !cache.test(source) || !source.includes(core)) {
					throw new Error(
						'Transformers.js large-file patch no longer matches; review the upgraded loader before building.',
					);
				}
				source = source
					.replace(reader, 'const readResponse = readModelResponse;\n')
					.replace(cache, 'new Response(modelCacheStream(result),')
					.replace(core, `${core}\n bufferOrPathPromise.catch(() => {});`);
				return {
					contents: `import { readModelResponse, modelCacheStream } from ${JSON.stringify(resolve('iframe/src/model-response.ts'))};\n${source}`,
					loader: 'js',
				};
			});
		},
	};
}
