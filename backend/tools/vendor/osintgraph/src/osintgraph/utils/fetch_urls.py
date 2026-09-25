import instaloader
from typing import List


def fetch_post_urls(L: instaloader.Instaloader, post: dict) -> List[str]:
    urls = []
    shortcode = post['shortcode']
    instapost = instaloader.Post.from_shortcode(L.context, shortcode)

    if instapost.typename in ("GraphImage", "GraphVideo"):
        urls.append(instapost.url)
    elif instapost.typename == "GraphSidecar":
        for node in instapost.get_sidecar_nodes():
            urls.append(node.display_url)
    return urls