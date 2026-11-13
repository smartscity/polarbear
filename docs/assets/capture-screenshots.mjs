import { createRequire } from 'node:module';
import {nativeFixture,menuItem} from '../../apps/desktop/tests/browser/fixtures/native.ts';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const require=createRequire(root+'/package.json');
const {chromium}=require('@playwright/test');
const doc=`# Design with clarity

A workspace for ideas that deserve more than a plain text file.

## From a question to a decision

Keep the reasoning, diagrams, and notes together.
**Your files stay yours.**

\`\`\`mermaid
flowchart LR
  A[Explore an idea] --> B[Describe the system]
  B --> C[Review together]
  C --> D[Ship with confidence]
  style A fill:#e0f2f1,stroke:#4b9994,color:#163d3a
  style B fill:#e6edf8,stroke:#6d91bd,color:#263e5a
  style C fill:#f0eafa,stroke:#9b82b6,color:#4d3964
  style D fill:#fff1d8,stroke:#c0a06b,color:#65502f
\`\`\`

## Make the next step visible

| Document | Purpose | Status |
| --- | --- | --- |
| Architecture | Explain the important boundaries | In review |
| Decisions | Preserve the reasoning | Up to date |
| Delivery notes | Turn decisions into action | Draft |

## Keep the details close

- [x] Describe the problem and its constraints
- [x] Sketch the flow alongside the explanation
- [ ] Review the trade-offs with the team

\`\`\`typescript
const workspace = { format: "Markdown", ownership: "yours" };
\`\`\`
`;
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
await nativeFixture(page);
await page.addInitScript(({doc})=>{
const rt=window.__TAURI_INTERNALS__,invoke=rt.invoke;
const tree=['Architecture.md','Decisions.md','Delivery notes.md'].map(name=>({id:name,name,itemType:'file'}));
rt.invoke=async(command,args={})=>{
 if(command==='open_markdown_file')return {workspaceRoot:'/demo/Fieldnotes',relativePath:'Architecture.md',markdownContent:doc,revision:'demo',tree};
 if(command==='list_workspace_files')return tree;
 if(command==='get_markdown_file_revision')return {exists:true,watchToken:'demo'};
 return invoke(command,args);
};
},{doc});
await page.goto('http://127.0.0.1:1427');
await page.evaluate(async()=>{const m=await import('/src/features/workspace/recentDocuments.ts');m.recentDocumentStore().record('/demo/Fieldnotes/Architecture.md',1)});
await menuItem(page,/Architecture.md/);
await menuItem(page,'Preview Mode');
await page.locator('.markdown-preview svg').first().waitFor();
await page.evaluate(()=>document.fonts.ready);
await page.screenshot({path:root+'/docs/assets/workspace-light.png'});
await menuItem(page,'Split Mode');
await page.locator('.markdown-preview svg').first().waitFor();
await page.screenshot({path:root+'/docs/assets/workspace-split.png'});
const caption=await browser.newPage({viewport:{width:1000,height:260}});
await caption.addInitScript(()=>{
const text=['Good documentation keeps the reasoning close to the code.', 'Start with the problem, make the trade-offs visible, and leave a clear next step.', 'The best notes help the next person understand why.'];
const rows=text.map((english,i)=>({id:i+1,sessionId:'demo',startMs:i*4000,endMs:(i+1)*4000,english,chinese:null,translationStatus:'pending'}));
const status={sessionId:'demo',state:'capturing',source:'system',partial:'',elapsedMs:12000,audioLevel:0,error:null,viewRevision:0,historyRequested:false,recordAudio:false};
window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
if(command!=='caption_request')return null;
if(args.request.action==='live')return {status,segments:rows};
if(args.request.action==='status')return status;
if(['tail','snapshot','segments'].includes(args.request.action))return rows;
if(args.request.action==='list')return [];
return null;
}};
});
await caption.goto('http://127.0.0.1:1427/caption.html?surface=caption');
await caption.locator('.caption-live-english').waitFor();
await caption.screenshot({path:root+'/docs/assets/live-caption.png'});
console.log('Screenshots saved.');
await browser.close();
