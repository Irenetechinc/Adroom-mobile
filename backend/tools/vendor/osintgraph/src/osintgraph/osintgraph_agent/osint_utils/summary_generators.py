import json

def generate_image_summary(image_analysis_str: str) -> str:
    def generate_image_summary(analysis: dict) -> str:
        phrases = []
        if analysis.get("image_type"):
            phrases.append(f"The image is a {analysis['image_type']}.")
        if analysis.get("image_tone"):
            phrases.append(f"It has a {analysis['image_tone']} tone.")
        if analysis.get("image_scenario"):
            phrases.append(f"The scenario depicted is {analysis['image_scenario']}.")
        if analysis.get("image_intent"):
            phrases.append(f"The intent appears to be {analysis['image_intent']}.")
        if analysis.get("people_count_visible"):
            phrases.append(f"People visible: {analysis['people_count_visible']}.")
        if analysis.get("people_gender"):
            phrases.append(f"Apparent gender {analysis['people_gender']}.")
        if analysis.get("notable_objects"):
            phrases.append(f"Notable objects: {analysis['notable_objects']}.")
        if analysis.get("animals_seen"):
            phrases.append(f"Animals present: {analysis['animals_seen']}.")
        if analysis.get("text_present"):
            if analysis.get("text_transcribed"):
                phrases.append(f"Text on image: '{analysis['text_transcribed']}'.")
            if analysis.get("text_meaning"):
                phrases.append(f"It means: {analysis['text_meaning']}.")
        if analysis.get("key_takeaways"):
            phrases.append(f"Key insight: {analysis['key_takeaways']}.")
        return " ".join(phrases)

    try:
        image_analyses = json.loads(image_analysis_str)
        if not isinstance(image_analyses, list):
            return "Invalid input: expected a JSON list of image analysis objects."
        summaries = [
            f"Image {idx+1}: {generate_image_summary(img)}"
            for idx, img in enumerate(image_analyses)
        ]
        return "\n".join(summaries)
    except Exception as e:
        return f"Error parsing image analysis string: {str(e)}"
    


def generate_post_summary(post_summary_str: str) -> str:
    try:
        summary = json.loads(post_summary_str)

        parts = []

        # === Metadata
        meta = summary.get("post_metadata_summary", {})
        parts.append(f"This post is a {meta.get('post_type', 'post')} with a {meta.get('post_tone', 'neutral')} tone, intended for {meta.get('target_audience', 'general audience')}.")
        parts.append(f"The poster appears to be a {meta.get('poster_role_or_affiliation', 'user')} motivated by {meta.get('posting_motivation', 'sharing')}.")
        if meta.get("sponsored_or_promotional"):
            parts.append("It is a sponsored or promotional post.")
        else:
            parts.append("It is not promotional.")

        # === Visual Analysis
        visual = summary.get("visual_analysis_summary", {})
        if visual.get("key_findings"):
            parts.append(f"Visual content: {visual['key_findings']}.")
        if visual.get("notable_objects_or_symbols"):
            parts.append(f"Symbols or objects: {visual['notable_objects_or_symbols']}.")
        if visual.get("emotion_or_energy_level"):
            parts.append(f"Emotional tone: {visual['emotion_or_energy_level']}.")

        # === Comments
        comments = summary.get("comment_section_analysis", {})
        if comments.get("interaction_patterns") and comments.get("interaction_patterns") != "Zero engagement beyond likes":
            parts.append(f"Comments show {comments.get('overall_sentiment', 'neutral sentiment')} with patterns like {comments['interaction_patterns']}.")
        else:
            parts.append("There is little or no engagement in the comments.")

        # === Behavior and Social Insight
        social = summary.get("behavioral_and_social_insight", {})
        if social.get("likely_poster_motivation"):
            parts.append(f"Motivation: {social['likely_poster_motivation']}.")
        if social.get("social_group_affiliations"):
            parts.append(f"Group affiliation: {social['social_group_affiliations']}.")

        # === OSINT Value
        osint = summary.get("osint_value", {})
        parts.append(f"OSINT confidence: {osint.get('confidence_level', 'Unknown')}.")
        parts.append(f"Intelligence usefulness: {osint.get('intelligence_usefulness', 'N/A')}.")
        if osint.get("summary_takeaways"):
            parts.append(f"Summary: {osint['summary_takeaways']}.")

        return " ".join(parts)

    except Exception as e:
        return f"[ERROR] Invalid post_summary string: {e}"



def generate_account_summary(account_analysis_str: str) -> str:
    try:
        data = json.loads(account_analysis_str)
        summary = data.get("account_summary", {})
        parts = []

        # Who runs this account
        who = summary.get("who_runs_this_account", {})
        if who.get("summary"):
            parts.append(f"Account owner: {who['summary']}")

        # What type of account
        typ = summary.get("what_type_of_account", {})
        if typ.get("label"):
            parts.append(f"Account type: {typ['label']}")
        if typ.get("reasoning"):
            parts.append(f"Reasoning: {typ['reasoning']}")

        # Why this account exists
        why = summary.get("why_this_account_exists", {})
        if why.get("main_purpose"):
            parts.append(f"Main purpose: {why['main_purpose']}")
        if isinstance(why.get("supporting_signals"), list):
            for signal in why["supporting_signals"]:
                parts.append(f"- {signal}")

        # Who is the target audience
        aud = summary.get("who_is_the_target_audience", {})
        if aud.get("summary"):
            parts.append(f"Target audience: {aud['summary']}")
        if aud.get("reasoning"):
            parts.append(f"Audience reasoning: {aud['reasoning']}")

        # What it posts about
        topics = summary.get("what_it_posts_about", {}).get("topic_distribution", [])
        if isinstance(topics, list):
            parts.append("Topics posted about:")
            for item in topics:
                topic = item.get("topic", "")
                percent = item.get("percentage", "")
                if topic or percent:
                    parts.append(f"- {topic}: {percent}%")

        # How often it posts
        freq = summary.get("how_often_it_posts", {})
        if freq.get("avg_posts_per_month"):
            parts.append(f"Posting frequency: {freq['avg_posts_per_month']}")
        if freq.get("most_active_days"):
            parts.append(f"Most active days: {', '.join(freq['most_active_days'])}")
        if freq.get("seasonal_patterns"):
            parts.append(f"Seasonal patterns: {freq['seasonal_patterns']}")

        # Who comments on it
        comm = summary.get("who_comments_on_it", {})
        prof = comm.get("audience_profile", {})
        if prof.get("likely_age_range"):
            parts.append(f"Audience age range: {prof['likely_age_range']}")
        if prof.get("languages_used"):
            parts.append(f"Comment languages: {', '.join(prof['languages_used'])}")
        if prof.get("comment_style"):
            parts.append(f"Comment style: {prof['comment_style']}")
        if prof.get("emotional_tone"):
            parts.append(f"Emotional tone: {prof['emotional_tone']}")
        if comm.get("relationship_to_owner"):
            parts.append(f"Relationship to poster: {comm['relationship_to_owner']}")

        # How comments look
        look = summary.get("how_comments_look", {})
        if look.get("comment_quality"):
            parts.append(f"Comment quality: {look['comment_quality']}")
        if look.get("reply_behavior"):
            parts.append(f"Reply behavior: {look['reply_behavior']}")
        if look.get("engagement_style"):
            parts.append(f"Engagement style: {look['engagement_style']}")
        if look.get("detected_bots_or_fake_activity") is True:
            parts.append("Possible bot or fake activity detected.")

        # Notable anomalies
        flags = summary.get("notable_flags_or_anomalies", {})
        if flags.get("inconsistencies"):
            parts.append("Inconsistencies:")
            for item in flags["inconsistencies"]:
                parts.append(f"- {item}")
        if flags.get("suspicious_behavior"):
            parts.append("Suspicious behavior:")
            for item in flags["suspicious_behavior"]:
                parts.append(f"- {item}")
        if flags.get("possible_account_switch_history"):
            parts.append("Possible account switch history detected.")

        # Language and text patterns
        lang = summary.get("language_and_text_patterns", {})
        if lang.get("caption_language"):
            parts.append(f"Caption languages: {', '.join(lang['caption_language'])}")
        if lang.get("common_caption_themes"):
            parts.append("Common caption themes:")
            for theme in lang["common_caption_themes"]:
                parts.append(f"- {theme}")
        if lang.get("hashtags_usage"):
            parts.append(f"Hashtag usage: {lang['hashtags_usage']}")
        if lang.get("emoji_usage"):
            parts.append(f"Emoji usage: {lang['emoji_usage']}")
        if isinstance(lang.get("comment_language_distribution"), dict):
            parts.append("Comment language distribution:")
            for lang_code, percent in lang["comment_language_distribution"].items():
                parts.append(f"- {lang_code}: {percent}")
        if lang.get("comment_length"):
            parts.append(f"Comment length: {lang['comment_length']}")

        # Final summary
        if summary.get("summary_notes"):
            parts.append(f"Final notes: {summary['summary_notes']}")

        return "\n".join(parts)

    except Exception as e:
        return f"[ERROR] Failed to generate summary: {e}"
