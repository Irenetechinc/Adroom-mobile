from .iso_parser import safe_iso
import re
import json

## Extract target user data
def extract_profile_data(profile):
    """
    General function to extract profile data from a profile.
    Can be used for followers, followees, or single user profiles.
    """
    return {
        'username': getattr(profile, 'username', None),
        'id': int(getattr(profile, 'userid', None)),
        'fullname': getattr(profile, 'full_name', None),
        'bio': getattr(profile, 'biography', None),
        'biography_mentions': getattr(profile, 'biography_mentions', None),
        'biography_hashtags': getattr(profile, 'biography_hashtags', None),
        # 'blocked_by_viewer': getattr(profile, 'blocked_by_viewer', None),
        'business_category_name': getattr(profile, 'business_category_name', None),
        'external_url': getattr(profile, 'external_url', None),
        # 'followed_by_viewer': getattr(profile, 'followed_by_viewer', None),
        'followees': getattr(profile, 'followees', None),
        'followers': getattr(profile, 'followers', None),
        # 'follows_viewer': getattr(profile, 'follows_viewer', None),
        # 'has_blocked_viewer': getattr(profile, 'has_blocked_viewer', None),
        'has_highlight_reels': getattr(profile, 'has_highlight_reels', None),
        'has_public_story': getattr(profile, 'has_public_story', None),
        'is_business_account': getattr(profile, 'is_business_account', None),
        'is_private': getattr(profile, 'is_private', None),
        'is_verified': getattr(profile, 'is_verified', None),
        'profile_pic_url': getattr(profile, 'profile_pic_url', None),
        'profile_pic_url_no_iphone': getattr(profile, 'profile_pic_url_no_iphone', None),
        'mediacount': getattr(profile, 'mediacount', None),
        # 'igtvcount': getattr(profile, 'igtvcount', None),
        # 'has_requested_viewer': getattr(profile, 'has_requested_viewer', None),
        'account_analysis': "",        
    }

## Extract follower/followee data
def extract_user_metadata(person):
    """
    Maps the follower object to a dictionary containing relevant data.
    """
    return {
        'id': int(person._node.get('id', None)),
        'username': person._node.get('username', None),
        'fullname': person._node.get('full_name', None),
        'profile_pic_url': person._node.get('profile_pic_url', None),
        'is_verified': person._node.get('is_verified', None),
        'has_public_story': getattr(person, '_has_public_story', None)
    }


def extract_comment_data(comment):
    return {
        'created_at_utc': safe_iso(getattr(comment, 'created_at_utc', None)),
        'id': int(getattr(comment, 'id', None)),
        'owner_id': int(comment.owner._node['id']),
        'likes_count': getattr(comment, 'likes_count', None),
        'text': getattr(comment, 'text', None)

    }

def extract_post_data(post):
    """
    Extracts all useful attributes from an instaloader.Post object
    into a dictionary for later use or display.
    """
    return {
        'shortcode': getattr(post, 'shortcode', None),
        'id': int(getattr(post, 'mediaid', None)),
        'typename': getattr(post, 'typename', None),
        'is_video': getattr(post, 'is_video', None),
        # 'video_url': getattr(post, 'video_url', None),
        'video_duration': getattr(post, 'video_duration', None),
        'video_view_count': getattr(post, 'video_view_count', None),
        # 'url': getattr(post, 'url', None),
        'caption': getattr(post, 'caption', None),
        'pcaption': getattr(post, 'pcaption', None),
        'caption_hashtags': getattr(post, 'caption_hashtags', None),
        'caption_mentions': getattr(post, 'caption_mentions', None),
        'accessibility_caption': getattr(post, 'accessibility_caption', None),
        'likes': getattr(post, 'likes', None),
        'likers_list': getattr(post, 'likers_list', None),
        'comments': getattr(post, 'comments', None),
        'comments_details': getattr(post, 'comments_details', None),
        'viewer_has_liked': getattr(post, 'viewer_has_liked', None),
        'date_utc': safe_iso(getattr(post, 'date_utc', None)),
        'date_local': safe_iso(getattr(post, 'date_local', None)),
        # 'location': {
        #     'id': getattr(post.location, 'id', None),
        #     'name': getattr(post.location, 'name', None),
        #     'lat': getattr(post.location, 'lat', None),
        #     'lng': getattr(post.location, 'lng', None),
        #     'slug': getattr(post.location, 'slug', None),
        #     'has_public_page': getattr(post.location, 'has_public_page', None)
        # } if post.location else None,
        'mediacount': getattr(post, 'mediacount', None),
        'owner_id': getattr(post, 'owner_id', None),
        'owner_username': getattr(post, 'owner_username', None),
        'title': getattr(post, 'title', None),
        # 'sponsor_users': [s.username for s in getattr(post, 'sponsor_users', [])],
        'tagged_users': getattr(post, 'tagged_users', None),
        'is_sponsored': getattr(post, 'is_sponsored', None),
        'is_pinned': getattr(post, 'is_pinned', None),
        'image_analysis': "",
        'post_analysis':"",
    }

def extract_json_block(raw: str):
    raw = raw.strip()

    # Attempt 1: Try direct parse
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e1:
        first_error = e1  # Save first error

    # Attempt 2: Remove code fences like ```json ... ```
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.IGNORECASE).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # Attempt 3a: Fallback between first '{' and last '}'
    start = raw.find("{")
    end = raw.rfind("}")
    if start != -1 and end != -1 and start < end:
        try:
            json_str = raw[start:end + 1]
            return json.loads(json_str)
        except json.JSONDecodeError:
            pass

    # Attempt 3b: Fallback between first '[' and last ']'
    start = raw.find("[")
    end = raw.rfind("]")
    if start != -1 and end != -1 and start < end:
        try:
            json_str = raw[start:end + 1]
            return json.loads(json_str)
        except json.JSONDecodeError:
            pass

    # Final fallback: return first error and full raw input
    return {
        "error": f"{first_error.msg} (line {first_error.lineno}, col {first_error.colno})",
        "raw_input": raw
    }
