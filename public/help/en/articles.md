# Article Publishing

Articles lets you write Markdown once and publish it to your Astro blog and
WeChat Official Account.

## Write

Open Articles and choose New article to create a draft with a Markdown
frontmatter template: fill in the slug, title and body, then save. The post
appears in the left list.

## Configure publishing

Publishing settings opens the Article Publishing settings tab: the WeChat
Official Account needs an App ID, App Secret, site URL and author; the blog
server needs a host, username, password and remote directory. You can also
set the Astro source directory to sync existing posts.

## Publish

- Sync to WeChat draft: save the post as a WeChat draft, then edit it in the
  Official Account backend before publishing;
- Sync and publish to WeChat: publish the post directly;
- Publish existing WeChat draft: publish a previously synced draft;
- Publish to blog: upload the post to the configured blog server;
- Sync from source: pull existing posts from the local Astro source directory.

## Notes

Missing credentials produce clear localised messages that guide you to
publishing settings. The WeChat and blog configuration only appears when the
Articles plugin is enabled.
