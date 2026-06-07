import {
  appSubtitle,
  appTitle,
  featureCards,
  githubSettingsPage,
  hero,
  pluginsPage,
} from "./App";

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
