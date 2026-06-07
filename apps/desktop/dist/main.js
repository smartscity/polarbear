const appTitle = "Polarbear";

const appSubtitle =
  "A local-first Markdown editor for GitHub-based knowledge workflows.";

const hero = {
  title: "Polarbear",
  subtitle:
    "A local-first Markdown editor for writers, developers, and GitHub-based knowledge workflows.",
};

const featureCards = [
  {
    title: "Local-first Writing",
    description:
      "Open, edit, and preview Markdown files directly on your device.",
    titleZh: "本地优先写作",
    descriptionZh: "直接在你的设备上打开、编辑和预览 Markdown 文件。",
  },
  {
    title: "Mermaid Diagrams",
    description:
      "Render, zoom, and inspect architecture diagrams without leaving your document.",
    titleZh: "Mermaid 图表",
    descriptionZh: "在文档中渲染、放大和查看架构图。",
  },
  {
    title: "GitHub Workflow",
    description:
      "Read, edit, and commit Markdown documents back to your repository.",
    titleZh: "GitHub 工作流",
    descriptionZh: "读取、编辑并提交 Markdown 文档到你的 GitHub 仓库。",
  },
];

const pluginsPage = {
  title: "Plugins",
  description:
    "Polarbear uses plugins to keep core editing, diagram rendering, repository sync, and capabilities clearly separated.",
  builtInPlugins: [
    {
      id: "markdown-preview",
      description: "Provides Markdown preview rendering.",
    },
    {
      id: "mermaid-renderer",
      description:
        "Renders Mermaid diagrams and enables zoomable diagram viewing.",
    },
    {
      id: "github-sync",
      description: "Connects Polarbear with GitHub repositories.",
    },
  ],
};

const githubSettingsPage = {
  title: "GitHub Workflow",
  description:
    "Connect Polarbear to a GitHub repository so you can read, edit, and commit Markdown documents directly from the app.",
  tokenNotice:
    "Your GitHub token must never be printed in logs or stored in plain text. Polarbear accesses it through the SecretStore abstraction.",
};

function PolarbearApp() {
  return `${hero.title}: ${hero.subtitle}`;
}



const root = document.querySelector<HTMLDivElement>("#root");

if (root) {
  root.innerHTML = `
    <main>
      <section class="hero">
        <h1>${hero.title}</h1>
        <p>${hero.subtitle}</p>
      </section>
      <section aria-label="${appTitle}">
        <p>${appSubtitle}</p>
        ${featureCards
          .map(
            (feature) => `
              <article>
                <h2>${feature.title}</h2>
                <p>${feature.description}</p>
              </article>
            `,
          )
          .join("")}
      </section>
      <section>
        <h2>${pluginsPage.title}</h2>
        <p>${pluginsPage.description}</p>
      </section>
      <section>
        <h2>${githubSettingsPage.title}</h2>
        <p>${githubSettingsPage.description}</p>
        <p>${githubSettingsPage.tokenNotice}</p>
      </section>
    </main>
  `;
}
