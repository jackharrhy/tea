export default `
  <h1>4orm cli</h1>

  <section class="panel">
    <h2>manage pages from your terminal</h2>
    <p>
      The 4orm CLI lets you publish pages, update them as you work, and upload
      media, right from the command line.
    </p>
    <p>Download it, run <code>4orm login</code>, and you are good to go.</p>
  </section>

  <section class="panel" id="downloads">
    <h2><a href="#downloads">downloads</a></h2>
    <ul>
      <li><a href="/cli/download/macos-arm64">macos-arm64</a></li><li><a href="/cli/download/macos-amd64">macos-amd64</a></li><li><a href="/cli/download/linux-arm64">linux-arm64</a></li><li><a href="/cli/download/linux-amd64">linux-amd64</a></li><li><a href="/cli/download/windows-arm64">windows-arm64</a></li><li><a href="/cli/download/windows-amd64">windows-amd64</a></li>
    </ul>
    <p class="muted">Choose the download for your system.</p>
  </section>

  <section class="panel" id="quick-start">
    <h2><a href="#quick-start">quick start</a></h2>
  <pre><code>4orm login
4orm page publish about.html
4orm page publish notes.md
4orm media upload avatar.png
4orm media list
4orm update</code></pre>
    <p>
      A file named <code>about.html</code> becomes the <code>about</code> page.
    </p>
  </section>

  <section class="panel" id="what-you-can-do">
    <h2><a href="#what-you-can-do">what you can do</a></h2>
    <ul>
      <li>publish HTML and Markdown pages</li>
      <li>list and remove your pages</li>
      <li>upload, list, and remove images, audio, and other media</li>
      <li>update the CLI without downloading it again</li>
      <li>work on your site without leaving your editor</li>
    </ul>
    <p>
      Run <code>4orm login</code> once, then use the commands whenever you want
      to update your site.
    </p>
  </section>
`;
