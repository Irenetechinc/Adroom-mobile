import json
import time

from google.api_core.exceptions import ResourceExhausted, TooManyRequests
from langchain_core.messages import HumanMessage, SystemMessage

from ..utils.data_extractors import extract_json_block
from ..utils.prompts import image_analysis, post_analysis, account_analysis
from ..utils.fetch_urls import fetch_post_urls
from ..services.llm_models import gemini_2_0_flash_with_limit, gemini_2_5_flash_llm_with_limit


class LLMAnalyzer:

    def __init__(self, default_model=gemini_2_0_flash_with_limit, fallback_model=gemini_2_5_flash_llm_with_limit):
        self.default_model = default_model
        self.fallback_model = fallback_model

    def analyze_image(self, url: str, system_prompt: str,  json_output: bool, max_retries=13, model_switch_threshold=1) -> dict:
        decode_failures = 0

        for attempt in range(max_retries):
            try:
                # print(f"[Process] Processing URL: {url}")
                current_model = (
                    self.fallback_model if decode_failures >= model_switch_threshold and self.fallback_model
                    else self.default_model
                )
                messages = [
                    SystemMessage(content=system_prompt),
                    HumanMessage(content=[{
                        "type": "image_url",
                        "image_url": {"url": url}
                    }])
                ]

                result = current_model.invoke(messages).content
                if json_output:
                    parsed = extract_json_block(result)

                    if isinstance(parsed, dict) and "error" in parsed:
                        decode_failures += 1
                        continue  # or handle as needed
                    return parsed
                return result
            except (ResourceExhausted, TooManyRequests) as e:
                if attempt == max_retries - 1:
                    raise e
                time.sleep(10)
            except Exception as e:
                raise e
        raise RuntimeError("Image analysis failed after retries")


    def analyze_text(self, user_prompt: str, system_prompt: str, json_output: bool= False, max_retries=13, model_switch_threshold=1) -> dict | str:
        decode_failures = 0

        for attempt in range(max_retries):
            try:
                current_model = (
                    self.fallback_model if decode_failures >= model_switch_threshold and self.fallback_model
                    else self.default_model
                )

                messages = [
                    SystemMessage(content=system_prompt),
                    HumanMessage(content=user_prompt)
                ]

                result = current_model.invoke(messages).content

                if json_output:
                    parsed = extract_json_block(result)

                    if isinstance(parsed, dict) and "error" in parsed:
                        decode_failures += 1
                        continue  # or handle as needed
                    return parsed
                return result
            except (ResourceExhausted, TooManyRequests) as e:
                if attempt == max_retries - 1:
                    raise e
                time.sleep(10)
            except Exception as e:
                raise e
        raise RuntimeError("Text analysis failed after retries")
            

    def process_post(self, insta_manager, post):

        if not post.get("post_analysis") or post["post_analysis"].strip() == "":

            if not post.get("image_analysis") or post["image_analysis"].strip() == "":
                urls = fetch_post_urls(insta_manager.L, post)
                try: 
                    results = [self.analyze_image(url, system_prompt=image_analysis, json_output=True) for url in urls]
                    post["image_analysis"] = json.dumps(results)
                    insta_manager.neo4j_manager.execute_write(insta_manager.neo4j_manager.manage_post_relationships, post , True)
                    # print(f"✅ Image analysis complete for post {post['id']}")

                except Exception as e:
                    raise e
            try:
                text = "Post contextual background: " 
                include_keys = { "is_video", "caption", "pcaption", "caption_hashtags", "caption_mentions", "likes", "comments", "date_utc", "date_local", "title", "tagged_users", "is_sponsored", "is_pinned", "image_analysis"}
                post_inf = {k: v for k, v in post.items() if k  in include_keys}
                post_inf['image_analysis'] = json.loads(post_inf['image_analysis'])
                text += json.dumps(post_inf, indent=2)
                text += ".\n\nComments:"
                text += json.dumps(insta_manager.neo4j_manager.execute_read(insta_manager.neo4j_manager.get_comments_with_replies_by_post_id, post["id"]), indent=2) 
                post["post_analysis"] = json.dumps(self.analyze_text(user_prompt=text, system_prompt=post_analysis, json_output=True ))
                insta_manager.neo4j_manager.execute_write(insta_manager.neo4j_manager.manage_post_relationships, post , True)

            except Exception as e:
                raise e
        
        ## debug 
        # with open(f'posts_dump{post["id"]}.json', 'w', encoding='utf-8') as f:
        #     json.dump(post, f, indent=4, ensure_ascii=False)

    def process_account(self, insta_manager, username):
        
        try:
            profile = insta_manager.neo4j_manager.execute_read(insta_manager.neo4j_manager.get_person_by_username, username)
            posts = insta_manager.neo4j_manager.get_posts_by_username(username)

            profile_include_keys = { "username", "fullname", "bio", "followers", "followees", "is_verified", "is_business_account", "business_category_name", "biography_hashtags", "biography_mentions"}
            post_include_keys = { "id", "is_video", "caption", "caption_hashtags", "caption_mentions", "likes", "date_utc", "date_local", "title", "tagged_users", "is_sponsored", "is_pinned", "post_analysis"}

            text = "Profile metadata: "
            profile_metadata = {k: v for k, v in profile.items() if k  in profile_include_keys}
            text += json.dumps(profile_metadata, indent=2)
            text += "\n\nPosts:\n"

            for i, post in enumerate(posts, 1):
                text += f"\nPost {i}:\n"
                post_metadata = {k: v for k, v in post.items() if k  in post_include_keys}
                try:
                    post_metadata['post_analysis'] = json.loads(post_metadata.get('post_analysis', '{}'))
                except Exception as e:
                    post_metadata['post_analysis'] = {}
                text += json.dumps(post_metadata, indent=2)

            profile["account_analysis"] = json.dumps(self.analyze_text(user_prompt=text, system_prompt=account_analysis, json_output=True))
            insta_manager.neo4j_manager.execute_write(insta_manager.neo4j_manager.create_user, profile)

            # debug
            # with open(f'profile_dump{profile["id"]}.json', 'w', encoding='utf-8') as f:
            #     json.dump(profile, f, indent=4, ensure_ascii=False)

        except Exception as e:
            raise e
        