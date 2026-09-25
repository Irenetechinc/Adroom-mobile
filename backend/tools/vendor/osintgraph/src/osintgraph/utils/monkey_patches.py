import instaloader
from typing import  Iterator

## Monkey Patching

def custom_get_likes(self) -> Iterator[instaloader.Profile]:
    """
    Iterate over all likes of the post. A :class:`Profile` instance of each likee is yielded.

    .. versionchanged:: 4.5.4
        Require being logged in (as required by Instagram).
    """
    if not self._context.is_logged_in:
        raise instaloader.LoginRequiredException("Login required to access likes of a post.")
    if self.likes == 0:
        # Avoid doing additional requests if there are no comments
        return

    yield from (instaloader.Profile(self._context, user) for user in self._context.get_iphone_json(path='api/v1/media/{}/likers/'.format(self.mediaid), params={})['users'])