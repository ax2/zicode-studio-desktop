import assert from 'node:assert/strict';
import path from 'node:path';
import {pipeline} from '@huggingface/transformers';

assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');
const models={en_zh:['Xenova/opus-mt-en-zh','046f55aec303cdee3e0318604406d4df20f1e8ea'],zh_en:['Xenova/opus-mt-zh-en','39d480d52a9ea3065a1f117adfe4dbc55de10e6f']};
const prepare=process.argv[2]==='prepare';
for(const pair of prepare?Object.keys(models):[process.argv[2]]) {
  const [id,revision]=models[pair];
  const translate=await pipeline('translation',id,{revision,device:'cpu',dtype:'q8',cache_dir:path.join(process.env.RUNNER_TEMP,'q56-onnx'),local_files_only:!prepare});
  if(prepare)console.log('Cached public model',id,revision);
  else {
    const input=Buffer.from(process.argv[3],'base64').toString('utf8');
    const [result]=await translate(input,{max_new_tokens:96,num_beams:3});
    assert.ok(typeof result.translation_text==='string'&&result.translation_text.trim());
    console.log(Buffer.from(result.translation_text).toString('base64'));
  }
  await translate.dispose();
}
