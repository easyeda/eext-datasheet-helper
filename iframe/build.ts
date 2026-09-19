import { cpSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import esbuild from 'esbuild';
import { transformersLargeFiles } from '../config/transformers-large-files';

async function main(): Promise<void> {
	mkdirSync('iframe/assets', { recursive: true });
	const ortDist = dirname(require.resolve('onnxruntime-web'));
	const nativeLoader = readFileSync(join(ortDist, 'ort-wasm-simd-threaded.asyncify.mjs'), 'utf8');
	if (!nativeLoader.includes('webgpuGetBuffer'))
		throw new Error('ORT loader does not support native WebGPU');
	await esbuild.build({
		entryPoints: ['iframe/src/inference-worker.ts'],
		outfile: 'iframe/local-worker.txt',
		bundle: true,
		format: 'esm',
		platform: 'browser',
		target: 'es2022',
		plugins: [transformersLargeFiles()],
		define: {
			'__ORT_LEGACY__': 'false',
			'__ORT_NATIVE_MJS_SOURCE__': JSON.stringify(nativeLoader),
			'__ORT_NATIVE_WASM_BASE64__': JSON.stringify(
				readFileSync(join(ortDist, 'ort-wasm-simd-threaded.asyncify.wasm')).toString('base64'),
			),
			'process.env.NODE_ENV': '"production"',
		},
	});
	const vlmOrt = dirname(
		require.resolve('onnxruntime-web', { paths: [dirname(require.resolve('transformers-vlm'))] }),
	);
	mkdirSync('iframe/assets/vlm-ort', { recursive: true });
	for (const file of readdirSync(vlmOrt).filter(file => /^ort-wasm.*\.(?:mjs|wasm)$/.test(file)))
		cpSync(join(vlmOrt, file), `iframe/assets/vlm-ort/${file}`);
	await esbuild.build({
		entryPoints: ['iframe/src/inference-worker.ts'],
		outfile: 'iframe/vlm-worker.txt',
		bundle: true,
		format: 'esm',
		platform: 'browser',
		target: 'es2022',
		alias: { '@huggingface/transformers': 'transformers-vlm' },
		define: {
			'__ORT_LEGACY__': 'true',
			'__ORT_NATIVE_MJS_SOURCE__': JSON.stringify(
				readFileSync(join(vlmOrt, 'ort-wasm-simd-threaded.jsep.mjs'), 'utf8'),
			),
			'__ORT_NATIVE_WASM_BASE64__': JSON.stringify(
				readFileSync(join(vlmOrt, 'ort-wasm-simd-threaded.jsep.wasm')).toString('base64'),
			),
			'process.env.NODE_ENV': '"production"',
		},
	});
	await esbuild.build({
		entryPoints: ['iframe/src/main.ts'],
		outfile: 'iframe/local.js',
		bundle: true,
		format: 'iife',
		platform: 'browser',
		target: 'es2022',
		loader: { '.txt': 'text' },
		define: {
			__PDF_WORKER_SOURCE__: JSON.stringify(readFileSync('node_modules/pdfjs-dist/build/pdf.worker.min.js', 'utf8')),
		},
	});
	for (const name of ['pdf.min.js', 'pdf.worker.min.js'])
		cpSync(`node_modules/pdfjs-dist/build/${name}`, `iframe/assets/${name}`);
	for (const name of ['cmaps', 'standard_fonts'])
		cpSync(`node_modules/pdfjs-dist/${name}`, `iframe/assets/${name}`, { recursive: true });
	cpSync('node_modules/tesseract.js/dist/tesseract.min.js', 'iframe/assets/tesseract.min.js');
	cpSync('node_modules/tesseract.js/dist/worker.min.js', 'iframe/assets/ocr-worker.min.js');
	mkdirSync('iframe/assets/ocr', { recursive: true });
	for (const name of readdirSync('node_modules/tesseract.js-core').filter(file => /\.wasm(?:\.js)?$/.test(file)))
		cpSync(`node_modules/tesseract.js-core/${name}`, `iframe/assets/ocr/${name}`);
	mkdirSync('iframe/assets/tessdata', { recursive: true });
	for (const language of ['eng', 'chi_sim']) {
		cpSync(
			`node_modules/@tesseract.js-data/${language}/4.0.0/${language}.traineddata.gz`,
			`iframe/assets/tessdata/${language}.traineddata.gz`,
		);
	}
	mkdirSync('iframe/assets/licenses', { recursive: true });
	for (const name of [
		'pdfjs-dist',
		'tesseract.js',
		'tesseract.js-core',
		'@huggingface/transformers',
		'onnxruntime-web',
		'transformers-vlm',
		'transformers-vlm/node_modules/onnxruntime-web',
	]) {
		const source = `node_modules/${name}`;
		for (const file of readdirSync(source).filter(file => /^license|^notice/i.test(file)))
			cpSync(`${source}/${file}`, `iframe/assets/licenses/${name.replaceAll('/', '-')}-${file}`);
	}
	mkdirSync('build/dist', { recursive: true });
}
main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
