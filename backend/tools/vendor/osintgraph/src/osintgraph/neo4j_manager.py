import json
import logging
from contextlib import contextmanager
from dataclasses import dataclass
from collections import defaultdict

from neo4j import GraphDatabase, Session
from neo4j.exceptions import Neo4jError, ServiceUnavailable
from dateutil.parser import isoparse

from typing import Optional, Dict, Generator

from .credential_manager import get_credential_manager
from .constants import USEFUL_FIELDS


@dataclass
class Neo4j_Config:
    debug_mode: bool = False


class Neo4jManager:
    def __init__(self, config: Neo4j_Config = Neo4j_Config()):
        
        self.config = config
        self.logger = logging.getLogger(__name__)
        self.logger.setLevel(logging.DEBUG if self.config.debug_mode else logging.INFO)
        self.credential = get_credential_manager()

        self.driver = None
        self._load_or_prompt_credentials()        
        self._connect_to_neo4j()
            

    def _load_or_prompt_credentials(self):
        uri = self.credential.get("NEO4J_URI")
        username = self.credential.get("NEO4J_USERNAME")
        password = self.credential.get("NEO4J_PASSWORD")

        if not uri or not username or not password:
            self.logger.warning("Neo4j configuration incomplete.\n\t\t       Please enter the following Neo4j details:")
            self.logger.info("NEO4J_URI: ")
            uri = input("                       > ")
            self.logger.info("NEO4J_USERNAME: ")
            username = input("                       > ")

            self.logger.info("NEO4J_PASSWORD: ")
            password = input("                       > ")

        self.URI = uri
        self.AUTH = (username, password)

    def _connect_to_neo4j(self):
        try:
            self.driver = GraphDatabase.driver(self.URI, auth=self.AUTH)
            self.driver.verify_connectivity()
            self.logger.info(f"✓  Neo4j connected: ({self.URI})")

            # Only save credentials after successful connection
            self.credential.set("NEO4J_URI", self.URI)
            self.credential.set("NEO4J_USERNAME", self.AUTH[0])  # username
            self.credential.set("NEO4J_PASSWORD", self.AUTH[1])  # password
        except (ServiceUnavailable, Exception) as e:
            self.logger.error(f"Failed to connect to Neo4j: {e}")
            self._handle_failed_connection()

    def _handle_failed_connection(self):
        self.logger.warning("Connection to Neo4j failed. Please re-enter your credentials.")
        self.credential.set("NEO4J_URI", "")
        self.credential.set("NEO4J_USERNAME", "")
        self.credential.set("NEO4J_PASSWORD", "")
        self._load_or_prompt_credentials()
        self._connect_to_neo4j()
    
    # Function to get session
    @contextmanager
    def get_session(self):
        
        # Create the session
        session = self.driver.session(database="neo4j")
        try:

            yield session  # Yield the session for use
        except Exception as e:
            # self.logger.error(f"Error during Neo4j session: {e}")
            raise
        finally:
            session.close()  # Ensure session is closed when done

    def execute_read(self, operation, *args, **kwargs):
        """Centralized method for read operations."""
        with self.get_session() as session:
            return session.execute_read(operation, *args, **kwargs)
    
    def execute_write(self, operation, *args, **kwargs):
        """Centralized method for write operations."""
        with self.get_session() as session:
            session.execute_write(operation, *args, **kwargs)
    def create_unique_constraint(self, session: Session):
        existing_constraints = session.run("SHOW CONSTRAINTS")
        existing_names = [record["name"] for record in existing_constraints]
        
        required_constraints = {
            "p_id_unique": """
                CREATE CONSTRAINT p_id_unique FOR (p:Person) REQUIRE p.id IS UNIQUE
            """,
            "p_username_unique": """
                CREATE CONSTRAINT p_username_unique FOR (p:Person) REQUIRE p.username IS UNIQUE
            """,
            "post_id_unique": """
                CREATE CONSTRAINT post_id_unique FOR (p:Post) REQUIRE p.id IS UNIQUE
            """,
            "post_shortcode_unique": """
                CREATE CONSTRAINT post_shortcode_unique FOR (p:Post) REQUIRE p.shortcode IS UNIQUE
            """,
            "comment_id_unique": """
                CREATE CONSTRAINT comment_id_unique FOR (c:Comment) REQUIRE c.id IS UNIQUE
            """
        }
        
        
        missing_constraints = [
            name for name in required_constraints if name not in existing_names
        ]

        for name in missing_constraints:
            session.run(required_constraints[name])

        if missing_constraints:
            self.logger.info("Neo4j Constraints initialize successfully")
        
    def create_vector_indexes(self, session: Session):
        # 1️⃣ Fetch existing indexes
        existing_indexes = session.run("SHOW INDEXES")
        existing_index_names = [record["name"] for record in existing_indexes]

        # 2️⃣ Dynamically generate required vector indexes
        required_vector_indexes = {}
        for label, fields in USEFUL_FIELDS.items():
            for field in fields:
                index_name = f"{label.lower()}_{field}_vector_index"
                required_vector_indexes[index_name] = f"""
                    CREATE VECTOR INDEX {index_name}
                    FOR (n:{label}) ON (n.{field}_vector)
                    OPTIONS {{
                    indexConfig: {{
                        `vector.dimensions`: 768,
                        `vector.similarity_function`: "cosine"
                    }}
                    }}
                """

        # 3️⃣ Find missing indexes
        missing_indexes = [
            name for name in required_vector_indexes if name not in existing_index_names
        ]

        # 4️⃣ Create missing indexes
        for name in missing_indexes:
            session.run(required_vector_indexes[name])

        if missing_indexes:
            self.logger.info(f"Neo4j Vector indexes initialize successfully")

        

    def create_users(self, session: Session, users):
        
        self.logger.debug("Attempting to update NEO4J db with users")

        session.run("""
            WITH $users AS users
            UNWIND users AS user
            MERGE (f:Person {id: user.id}) 
            ON CREATE SET
                f._profile_complete = false,
                f._followers_complete = false,
                f._followees_complete = false,
                f._posts_complete = false,
                f._posts_analysis_complete = false,
                f._account_analysis_complete = false,
                f._followers_resume_hash = "",
                f._followees_resume_hash = "",
                f._posts_resume_hash = ""
            SET
                f.username = COALESCE(user.username, ""),
                f.fullname = COALESCE(user.fullname, ""),
                f.profile_pic_url = COALESCE(user.profile_pic_url, ""),
                f.is_verified = COALESCE(user.is_verified, false)
        
        """, users=users)


    def create_user(self, session: Session, user):
        
        self.logger.debug(f"Attempting to update NEO4J db with adding {user['username']}")
        session.run("""
        MERGE (p:Person {id: $id})
        ON CREATE SET
            p._profile_complete = true,
            p._followers_complete = false,
            p._followees_complete = false,
            p._posts_complete = false,
            p._posts_analysis_complete = false,
            p._account_analysis_complete = false,
            p._followers_resume_hash = "",
            p._followees_resume_hash = "",
            p._posts_resume_hash = ""
        ON MATCH SET
                p._profile_complete = true
        SET 
            p.username = COALESCE($username, ""),
            p.fullname = COALESCE($fullname, ""),
            p.bio = COALESCE($bio, ""),
            p.biography_mentions = COALESCE($biography_mentions, []),
            p.biography_hashtags = COALESCE($biography_hashtags, []),
            p.business_category_name = COALESCE($business_category_name, ""),
            p.external_url = COALESCE($external_url, ""),
            p.followees = COALESCE($followees, 0),
            p.followers = COALESCE($followers, 0),
            p.has_highlight_reels = COALESCE($has_highlight_reels, false),
            p.has_public_story = COALESCE($has_public_story, false),
            p.is_business_account = COALESCE($is_business_account, false),
            p.is_private = COALESCE($is_private, false),
            p.is_verified = COALESCE($is_verified, false),
            p.profile_pic_url = COALESCE($profile_pic_url, ""),
            p.profile_pic_url_no_iphone = COALESCE($profile_pic_url_no_iphone, ""),
            p.mediacount = COALESCE($mediacount, 0),
            p.account_analysis = COALESCE($account_analysis, "")


         """, user)

    
    def find_incomplete_followees_by_popularity(self, session: Session, username):
        query = """
            WITH $username AS username
            MATCH (target:Person {username: $username})-[:FOLLOWS]->(p:Person)
            WHERE COALESCE(p.is_private, false) = false AND COALESCE(p._profile_complete, false) = false
            MATCH (p)<-[:FOLLOWS]-(f:Person)
            RETURN 
            p.username AS username, 
            COUNT(f) AS followers_count
            ORDER BY followers_count DESC
            LIMIT 100
        """
        result = session.run(query, username=username)
        return [record for record in result]

    def find_incomplete_targets(self, session: Session, username):
        query = """
            WITH $username AS username
            MATCH (target:Person {username: $username})-[:FOLLOWS]->(p:Person)
            WHERE COALESCE(p.is_private, false) = false
            AND COALESCE(p._profile_complete, true) = true
            AND (
                COALESCE(p._followers_complete, false) = false OR
                COALESCE(p._followees_complete, false) = false OR
                COALESCE(p._posts_complete, false) = false
            )
            MATCH (p)<-[:FOLLOWS]-(f:Person)
            RETURN 
            p.username AS username,
            COUNT(f) AS followers_count
            ORDER BY followers_count DESC
            LIMIT 100
        """
        result = session.run(query, username=username)
        return [record for record in result]

    def save_resume_hash(self, session: Session, id: int, hashes: dict[str, str]):
        prop_map = {
            "followers": "_followers_resume_hash",
            "followees": "_followees_resume_hash",
            "posts": "_posts_resume_hash",
        }

        updates = []
        params = {"id": id}

        for key, value in hashes.items():
            prop = prop_map.get(key)
            if prop:
                updates.append(f"p.{prop} = ${prop}")
                params[prop] = value

        if not updates:
            return  # Nothing to update

        query = f"""
            MATCH (p:Person {{id: $id}})
            SET {', '.join(updates)}
        """

        session.run(query, **params)

    # def save_resume_hash_v2(self, session, username, resume_hash):
        
    #     followers_resume_hash = resume_hash.get('followers', "")
    #     followees_resume_hash = resume_hash.get('followees', "")
    #     session.run("""
    #         MATCH (p:Person {username: $username})
    #         SET p.followers_resume_hash = $followers_resume_hash
    #         SET p.followees_resume_hash = $followees_resume_hash
    #         REMOVE p.resume_hash
    #         """,username=username, followers_resume_hash = followers_resume_hash, followees_resume_hash = followees_resume_hash
    #     )

    def get_resume_hashes(self, session: Session, username: str, types: list[str]) -> dict[str, str]:
        prop_map = {
            "followers": "_followers_resume_hash",
            "followees": "_followees_resume_hash",
            "posts": "_posts_resume_hash",
        }

        # Map requested types to properties
        props = {t: prop_map[t] for t in types}

        conditions = [f"p.{prop} <> ''" for prop in props.values()]
        return_clauses = [f"p.{prop} AS {t}" for t, prop in props.items()]

        where_clause = " OR ".join(conditions) if conditions else "true"

        query = f"""
            MATCH (p:Person {{username: $username}})
            WHERE {where_clause}
            RETURN {', '.join(return_clauses)}
            LIMIT 1
        """

        try:
            result = session.run(query, username=username)
            record = result.single()
            if not record:
                return {t: "" for t in types}
            return {t: record.get(t) or "" for t in types}
        except Neo4jError as e:
            self.logger.warning(f"Neo4j error fetching resume hashes for {username}: {e}")
            return {t: "" for t in types}

    def find_resume_hash(self, session: Session, limit=100):
    
        try: 
            result = session.run("""
                MATCH (p:Person)
                WHERE (p.followers_resume_hash IS NOT NULL AND p.followers_resume_hash <> "")
                OR (p.followees_resume_hash IS NOT NULL AND p.followees_resume_hash <> "")
                RETURN p.username AS username, 
                    p.followers_resume_hash AS followers_resume_hash,
                    p.followees_resume_hash AS followees_resume_hash
                LIMIT $limit
            """, limit=limit)
            
            return [record for record in result]
        except Neo4jError as e:
                self.logger.warning(f"Property not found for ID {id}, using default value.")
    def manage_follow_relationships(self, session: Session, user_id, result: dict):

        try:
            with self.get_session() as session:

                # === Handle FOLLOWEES if present ===
                if 'followees' in result:
                    followees_id = [f['id'] for f in result['followees']['data']]
                    session.execute_write(self.new_followees, user_id, followees_id)

                    if not result['followees'].get('batch_mode', False):
                        session.execute_write(self.unfollowed_followees, user_id, followees_id)
                        session.execute_write(self.refollowed_followees, user_id, followees_id)

                # === Handle FOLLOWERS if present ===
                if 'followers' in result:
                    followers_id = [f['id'] for f in result['followers']['data']]
                    session.execute_write(self.new_followers, user_id, followers_id)

                    if not result['followers'].get('batch_mode', False):
                        session.execute_write(self.unfollowed_followers, user_id, followers_id)
                        session.execute_write(self.refollowed_followers, user_id, followers_id)

        except Exception as e:
            self.logger.error(f"Error while managing relationships: {e}")
            raise


    
    def new_followees(self, session: Session, user_id, followees_id):
        # user_id = user['id']
        # followees_id =  [ followee['id']for followee in followees]
        session.run("""
            WITH $followees_id AS followees_id
            UNWIND followees_id AS followee_id
            MATCH (a:Person {id: $user_id}), (b:Person {id: followee_id})
            OPTIONAL MATCH (a)-[r1:FOLLOWS]->(b)
            OPTIONAL MATCH (a)-[r2:UNFOLLOWED]->(b)
            WHERE r1 IS NULL AND r2 IS NULL
            MERGE (a)-[:FOLLOWS]->(b) 

        """,user_id=user_id, followees_id=followees_id)
    def new_followers(self, session: Session, user_id, followers_id):
        # user_id = user['id']
        # followers_id =  [ follower['id']for follower in followers]
        session.run("""
            WITH $followers_id AS followers_id
            UNWIND followers_id AS follower_id
            MATCH (a:Person {id: $user_id}), (b:Person {id: follower_id})
            OPTIONAL MATCH (b)-[r1:FOLLOWS]->(a)
            OPTIONAL MATCH (b)-[r2:UNFOLLOWED]->(a)
            WHERE r1 IS NULL AND r2 IS NULL
            MERGE (b)-[:FOLLOWS]->(a) 

        """,user_id=user_id, followers_id=followers_id)

    def unfollowed_followees(self, session: Session, user_id, followees_id):
        # user_id = user['id']
        # followees_id =  [ followee['id']for followee in followees]
        result = session.run("""
                MATCH (a:Person {id: $user_id})-[:FOLLOWS]->(b:Person)
                WITH collect(b.id) AS existing_followees_id
                UNWIND existing_followees_id AS existing_followee_id
                WITH existing_followee_id, existing_followees_id, $current_followees_id AS current_followees_id
                WHERE NOT existing_followee_id IN current_followees_id
                MATCH (a:Person {id: $user_id})-[r:FOLLOWS]->(b:Person {id: existing_followee_id})
                MERGE (a)-[newRel:UNFOLLOWED]->(b) 
                ON CREATE SET newRel.unfollowed_at = datetime()
                DELETE r  
                
            """, user_id=user_id, current_followees_id=followees_id)
        
    def unfollowed_followers(self, session: Session, user_id, followers_id):
        # user_id = user['id']
        # followers_id =  [ follower['id']for follower in followers]
        result = session.run("""
                MATCH (a:Person)-[:FOLLOWS]->(b:Person{id: $user_id})
                WITH collect(a.id) AS existing_followers_id
                UNWIND existing_followers_id AS existing_follower_id
                WITH existing_follower_id, existing_followers_id, $current_followers_id AS current_followers_id
                WHERE NOT existing_follower_id IN current_followers_id
                MATCH (a:Person {id: existing_follower_id})-[r:FOLLOWS]->(b:Person {id: $user_id})
                MERGE (a)-[newRel:UNFOLLOWED]->(b) 
                ON CREATE SET newRel.unfollowed_at = datetime()
                DELETE r  
            """, user_id=user_id, current_followers_id=followers_id)
        
    def refollowed_followees(self, session: Session, user_id, followees_id):
            # user_id = user['id']
            # followees_id =  [ followee['id']for followee in followees]
            result = session.run("""
                WITH $followees_id_to_follow_back AS followees_id_to_follow_back
                UNWIND followees_id_to_follow_back AS followee_id
                MATCH (a:Person {id: $user_id})-[r:UNFOLLOWED]->(b:Person {id: followee_id})
                MERGE (a)-[newRel:FOLLOWS]->(b) 
                ON CREATE SET newRel.followed_at = datetime(), 
                        newRel.unfollowed_at = r.unfollowed_at
                DELETE r  
                
            """, user_id=user_id, followees_id_to_follow_back=followees_id)

    def refollowed_followers(self, session: Session, user_id, followers_id):
            # user_id = user['id']
            # followers_id =  [ follower['id']for follower in followers]
            result =session.run("""
                WITH $followers_id_to_follow_back AS followers_id_to_follow_back
                UNWIND followers_id_to_follow_back AS follower_id
                MATCH (a:Person {id: follower_id})-[r:UNFOLLOWED]->(b:Person {id: $user_id})
                MERGE (a)-[newRel:FOLLOWS]->(b) 
                ON CREATE SET newRel.followed_at = datetime(), 
                        newRel.unfollowed_at = r.unfollowed_at
                DELETE r  
                
            """, user_id=user_id, followers_id_to_follow_back=followers_id)

    def like_post(self, session: Session, likers):

        session.run("""
            WITH $likers AS likers
            UNWIND likers AS liker
            MATCH (a:Post {id: liker.liked_post_id}), (b:Person {id: liker.id})
            MERGE (b)-[:LIKED]->(a) 

        """, likers=likers)


    def liked_comment(self, session: Session, likers):

            session.run("""
                WITH $likers AS likers
                UNWIND likers AS liker
                MATCH (a:Comment {id: liker.liked_comment_id}), (b:Person {id: liker.id})
                MERGE (b)-[:LIKED]->(a) 

            """, likers=likers)
    def create_comments(self, session: Session, comments):
        session.run("""
            WITH $comments AS comments
            UNWIND comments AS comment
            MERGE (c:Comment {id: comment.id}) 
            SET
                c.id = comment.id,
                c.created_at_utc = datetime(comment.created_at_utc),
                c.likes_count = comment.likes_count,
                c.text = comment.text
        
        """, comments=comments)
                

    def manage_comment_relationships(self, session: Session, post_id, comments):
        session.run("""
                    
            WITH $comments AS comments
            UNWIND $comments AS comment
            MATCH (a:Comment {id: comment.id})

            MATCH (u:Person {id: comment.owner_id})
            MATCH (p:Post {id: $post_id})
            MERGE (u)-[:COMMENTED]->(a)
            MERGE (a)-[:ON]->(p)
            WITH a, comment
            WHERE comment.reply_id IS NOT NULL
            CALL (a, comment) {

                MATCH (b:Comment {id: comment.reply_id})
                MERGE (a)-[:REPLY_TO]->(b)
            RETURN NULL AS _
            }
            RETURN NULL AS _
        """,post_id=post_id ,comments=comments)

    def manage_post_relationships(self, session: Session, post: dict, is_update: bool = False ):
        cypher = ""
        if not is_update:
            cypher += "MERGE (owner:Person {id: $owner_id})"
        cypher +="""
            MERGE (p:Post {id: $id})
            SET p.shortcode = coalesce($shortcode, ""),
                p.title = coalesce($title, ""),
                p.typename = coalesce($typename, ""),
                // p.sidecars = coalesce($sidecars, ""),
                p.is_video = coalesce($is_video, false),
                p.video_duration = coalesce($video_duration, 0),
                p.video_view_count = coalesce($video_view_count, 0),
                // p.url = coalesce($url, null),
                p.caption = coalesce($caption, ""),
                p.pcaption = coalesce($pcaption, ""),
                p.caption_hashtags = coalesce($caption_hashtags, []),
                p.caption_mentions = coalesce($caption_mentions, []),
                p.accessibility_caption = coalesce($accessibility_caption, ""),
                p.likes = coalesce($likes, 0),
                p.comments = coalesce($comments, 0),
                p.date_utc = coalesce(datetime($date_utc), null),
                p.date_local = coalesce(datetime($date_local), null),
                p.mediacount = coalesce($mediacount, 0),
                p.tagged_users = coalesce($tagged_users, []),
                p.is_sponsored = coalesce($is_sponsored, false),
                p.is_pinned = coalesce($is_pinned, false),
                p.image_analysis = coalesce($image_analysis, ""),
                p.post_analysis = coalesce($post_analysis, "")
            """
        if not is_update:    
            cypher+="MERGE (owner)-[:POSTED]->(p)"
        
        session.run(cypher, post)
        if not is_update:
            if post['likes'] > 0:
                self.create_users(session, post['likers_list'])
                self.like_post(session, post['likers_list'])

            if post['comments'] > 0: 
                self.create_users(session, post['comments_details']['commentors_list'])
                self.create_comments(session, post['comments_details']['comments_list'])
                self.manage_comment_relationships(session, post['id'], post['comments_details']['comments_list'])
                if post['comments_details']['likers_list']:
                    self.create_users(session, post['comments_details']['likers_list'])
                    self.liked_comment(session, post['comments_details']['likers_list'])

    def set_completion_flags(self, session: Session, username: str, *, profile: Optional[bool] = None, followers: Optional[bool] = None, followees: Optional[bool] = None, posts: Optional[bool] = None, posts_analysis: Optional[bool] = None, account_analysis: Optional[bool] = None):
        updates = []
        params = {"username": username}

        if profile is not None:
            updates.append("p._profile_complete = $profile")
            params["profile"] = profile
        if followers is not None:
            updates.append("p._followers_complete = $followers")
            params["followers"] = followers
        if followees is not None:
            updates.append("p._followees_complete = $followees")
            params["followees"] = followees
        if posts is not None:
            updates.append("p._posts_complete = $posts")
            params["posts"] = posts
        if posts_analysis is not None:
            updates.append("p._posts_analysis_complete = $posts_analysis")
            params["posts_analysis"] = posts_analysis
        if account_analysis is not None:
            updates.append("p._account_analysis_complete = $account_analysis")
            params["account_analysis"] = account_analysis

        if not updates:
            return  # Nothing to update

        query = f"""
        MATCH (p:Person {{username: $username}})
        SET {', '.join(updates)}
        """
        self.logger.debug(f"Updating completion flags for user {username}: {params}")
        session.run(query, params)

    def get_completion_flags(self, session: Session, username: str) -> Dict[str, Optional[bool]]:
        query = """
        MATCH (p:Person {username: $username})
        RETURN 
            p._profile_complete AS profile, 
            p._followers_complete AS followers, 
            p._followees_complete AS followees, 
            p._posts_complete AS posts,
            p._posts_analysis_complete AS posts_analysis,
            p._account_analysis_complete AS account_analysis
        LIMIT 1
        """
        try:
            result = session.run(query, username=username)
            record = result.single()
            if not record:
                return {
                    "profile": None,
                    "followers": None,
                    "followees": None,
                    "posts": None,
                    "posts_analysis": None,
                    "account_analysis": None

                }
            return {
                "profile": record.get("profile"),
                "followers": record.get("followers"),
                "followees": record.get("followees"),
                "posts": record.get("posts"),
                "posts_analysis": record.get("posts_analysis"),
                "account_analysis": record.get("account_analysis")
            }
        except Exception as e:
            self.logger.warning(f"Error getting completion flags for {username}: {e}")
            return {
                    "profile": None,
                    "followers": None,
                    "followees": None,
                    "posts": None,
                    "posts_analysis": None,
                    "account_analysis": None
            }
        

    def get_person_by_username(self, session: Session, username: str) -> dict | None:

        result = session.run("""
        MATCH (p:Person {username: $username})
        RETURN p
        """, username=username)
        record = result.single()
        if record is None:
            return None  # No user found

        person_node = record["p"]
        
        person = dict(person_node)
        return person


    def get_posts_by_username(self, username: str) -> Generator[dict, None, None]:
        with self.driver.session() as session:
            query = """
            MATCH (p:Person {username: $username})-[:POSTED]->(post:Post)
            RETURN post {.*, date_utc: toString(post.date_utc), date_local: toString(post.date_local)}
            """
            result = session.run(query, username=username)
            for record in result:
                yield dict(record["post"])
    def get_posts_unanalyzed_by_username(self, username: str) -> Generator[dict, None, None]:
        with self.driver.session() as session:
            query = """
            MATCH (p:Person {username: $username})-[:POSTED]->(post:Post)
            WHERE post.post_analysis IS NULL OR post.post_analysis = ""
            RETURN post {.*, date_utc: toString(post.date_utc), date_local: toString(post.date_local)}
            """
            result = session.run(query, username=username)
            for record in result:
                yield dict(record["post"])
    def get_post_by_id(self, session, id: int) -> Optional[dict]:
        result = session.run("MATCH (p:Post {id: $id}) RETURN p {.*, date_utc: toString(p.date_utc), date_local: toString(p.date_local)}", id=id)
        record = result.single()
        if record:
            return dict(record["p"])
        return None

    def get_post_by_shortcode(self, session, shortcode: str) -> Optional[dict]:
        result = session.run("MATCH (p:Post {shortcode: $shortcode}) RETURN p {.*, date_utc: toString(p.date_utc), date_local: toString(p.date_local)}", shortcode=shortcode)
        record = result.single()
        if record:
            return dict(record["p"])
        return None
    def count_posts_by_username(self, session, username: str) -> int:
        query = """
        MATCH (p:Person {username: $username})-[:POSTED]->(post:Post)
        RETURN count(post) AS total
        """
        result = session.run(query, username=username)
        record = result.single()
        return record["total"] if record else 0

    def count_posts_unanalyzed_by_username(self, session, username: str) -> int:
        query = """
        MATCH (p:Person {username: $username})-[:POSTED]->(post:Post)
        WHERE post.post_analysis IS NULL OR post.post_analysis = ""
        RETURN count(post) AS total
        """
        result = session.run(query, username=username)
        record = result.single()
        return record["total"] if record else 0

    def get_comments_with_replies_by_post_id(self, session, post_id):
        query = """
        MATCH (c:Comment)-[:ON]->(p:Post {id: $post_id})
        OPTIONAL MATCH (c)-[:REPLY_TO]->(parent:Comment)
        RETURN c.id AS id, c.text AS text, c.likes_count AS likes_count, 
            toString(c.created_at_utc) AS timestamp, parent.id AS parent_id
        ORDER BY c.created_at_utc ASC
        """


        result = session.run(query, post_id=post_id)
        records = [r.data() for r in result]

        # Separate top-level comments and replies
        comments_by_id = {}
        children = defaultdict(list)

        for r in records:
            comment = {
                "text": r["text"],
                "timestamp": r["timestamp"],
                "likes_count": r["likes_count"],
                "replies": []
            }
            comments_by_id[r["id"]] = comment
            if r["parent_id"]:
                children[r["parent_id"]].append(comment)

        # Attach replies to their parent
        final_comments = []
        for r in records:
            if not r["parent_id"]:
                comment = comments_by_id[r["id"]]
                comment["replies"] = sorted(children[r["id"]], key=lambda x: isoparse(x["timestamp"]))
                final_comments.append(comment)

        # Sort top-level comments
        final_comments.sort(key=lambda x: isoparse(x["timestamp"]))
        return final_comments
    
    def get_partial_posts_by_username(self, username: str) -> Generator[dict, None, None]:
        with self.driver.session() as session:
            query = """
            MATCH (p:Person {username: $username})-[:POSTED]->(post:Post)
            RETURN post { .id, .comments, date_local: toString(post.date_local), .pcaption, .caption, .caption_mentions, .is_sponsored, .title, .caption_hashtags, .tagged_users, .is_video, date_utc: toString(post.date_utc), .mediacount, .likes, .image_analysis, .post_analysis} AS post
            """
            result = session.run(query, username=username)
            for record in result:
                post = dict(record["post"])
                if post.get('image_analysis'):
                    post['image_analysis'] = json.loads(post['image_analysis'])
                if post.get('post_analysis'):
                    post['post_analysis'] = json.loads(post['post_analysis'])
                yield dict(post)
    def get_comments_by_username(self, username: str):
        query = """
        MATCH (p:Person {username: $username})-[:COMMENTED]->(c:Comment)
        RETURN c {.*, created_at_utc: toString(c.created_at_utc)}
        """

        with self.driver.session() as session:
            result = session.run(query, username=username)
            for record in result:
                yield dict(record["c"])

    def get_full_comments_by_username(self, username: str):
        query = """
        MATCH (p:Person {username: $username})-[:COMMENTED]->(c:Comment)-[:ON]->(post:Post)
        OPTIONAL MATCH (c)-[:REPLY_TO]->(parentComment:Comment)
        RETURN c {.likes_count ,created_at_utc : toString(c.created_at_utc) ,.text} AS c, post {.id ,.pcaption ,.caption ,.caption_hashtags ,.tagged_users ,date_local: toString(post.date_local) ,date_utc: toString(post.date_utc) ,.image_analysis ,.post_analysis} AS post, parentComment {.likes_count ,created_at_utc: toString(parentComment.created_at_utc) ,.text} AS parentComment
        """

        with self.driver.session() as session:
            result = session.run(query, username=username)
            for record in result:
                comment = dict(record["c"])
                post = dict(record["post"])  # always exists
                parent_comment = dict(record["parentComment"]) if record["parentComment"] else None
                yield {
                    "comment": comment,
                    "replied_to_comment": parent_comment,
                    "post": post
                    
                }

    def get_liked_posts_by_username(self, username: str):
        query = """
        MATCH (p:Person {username: $username})-[:LIKED]->(post:Post)<-[:POSTED]-(owner:Person)
        RETURN post { .id ,.pcaption ,.caption ,.caption_hashtags ,.tagged_users ,date_local: toString(post.date_local) ,date_utc: toString(post.date_utc) ,.image_analysis ,.post_analysis} AS post, 
        owner.username AS post_owner_name, 
        EXISTS {MATCH (p)-[:FOLLOWS]->(owner)} AS user_follows_owner, 
        EXISTS {MATCH (owner)-[:FOLLOWS]->(p)} AS owner_follows_user

        """

        with self.driver.session() as session:
            result = session.run(query, username=username)
            for record in result:
                post = dict(record["post"])
                post["post_owner_name"] = record["post_owner_name"]
                post["user_follows_owner"] = record["user_follows_owner"]
                post["owner_follows_user"] = record["owner_follows_user"]
                post["mutual_follow"] = (
                    post["user_follows_owner"] and post["owner_follows_user"]
                )
                yield post
    def get_liked_comments_by_username(self, username: str):
        query = """
        MATCH (p:Person {username: $username})-[:LIKED]->(comment:Comment)
        RETURN comment {.likes_count ,created_at_utc: toString(comment.created_at_utc) ,.text} AS comment
        """

        with self.driver.session() as session:
            result = session.run(query, username=username)
            for record in result:
                yield dict(record["comment"])

    def get_followers_with_post_by_username(self, session, username: str) -> list[dict]:
        query = """
        MATCH (user:Person {username: $username})-[:FOLLOWS]->(followee:Person)
        WITH followee
        MATCH (followee)-[:POSTED]->(:Post)
        RETURN DISTINCT followee {
            .username,
            .fullname,
            .bio,
            .biography_mentions,
            .biography_hashtags,
            .business_category_name,
            .followees,
            .is_business_account,
            .account_analysis
        }
        """
        result = session.run(query, username=username)
        followees = []
        for record in result:
            followee_node = record["followee"]
            followees.append(dict(followee_node))
        return followees


    def get_schema_summary(self, session):
        try:
            result = session.run("CALL apoc.meta.schema() YIELD value RETURN value")

            records = list(result)
            if not records:
                return {"error": "No schema returned from APOC."}

            # Extract the 'value' map from the first record (assuming one row)
            schema = records[0]["value"]

            nodes = []
            relationships = []

            for key, entry in schema.items():
                if entry.get("type") == "node":
                    label = key
                    prop_info = entry.get("properties", {})

                    properties = [
                        {
                            "name": prop,
                            "type": prop_data.get("type", "UNKNOWN")
                        }
                        for prop, prop_data in prop_info.items()
                    ]
                    
                    nodes.append({
                        "label": label,
                        "properties": properties
                    })

                    # Extract outgoing/incoming relationships
                    for rel_type, rel_info in entry.get("relationships", {}).items():
                        targets = rel_info.get("labels", [])
                        direction = rel_info.get("direction", "")

                        for target in targets:
                            if direction == "out":
                                relationships.append({
                                    "type": rel_type,
                                    "start": label,
                                    "end": target
                                })
                            elif direction == "in":
                                relationships.append({
                                    "type": rel_type,
                                    "start": target,
                                    "end": label
                                })
                            else:
                                relationships.append({
                                    "type": rel_type,
                                    "start": label,
                                    "end": target
                                })

            # Deduplicate relationships
            seen = set()
            unique_relationships = []
            for rel in relationships:
                key = (rel["type"], rel["start"], rel["end"])
                if key not in seen:
                    seen.add(key)
                    unique_relationships.append(rel)

            schema_json = {
                "nodes": nodes,
                "relationships": unique_relationships
            }
            schema_description = ""
            for node in schema_json["nodes"]:
                props = ", ".join(f"{p['name']} ({p['type']})" for p in node["properties"])
                schema_description += f"- {node['label']}: {props}\n"

            schema_description += "\nRelationships:\n"
            for rel in schema_json["relationships"]:
                schema_description += f"- {rel['start']} -> {rel['type']} -> {rel['end']}\n"

            return schema_description
        except Exception as e:
            return {"error": str(e)}


    def run_cypher_query(self, session, cypher, vector=None):
        try:
            # Prepare parameters
            params = {}
            if vector is not None:
                params["vector"] = vector
            
            # Run query with optional vector
            result = session.run(cypher, params)
            records = [record.data() for record in result]

            # Access query summary to check for notifications
            summary = result.consume()
            notifications = []

            if summary.notifications is not None:
                for n in summary.notifications:
                    if isinstance(n, dict):
                        notifications.append(n)
                    else:
                        notifications.append({
                            "code": getattr(n, "code", None),
                            "title": getattr(n, "title", None),
                            "description": getattr(n, "description", None),
                            "severity": getattr(n, "severity", None),
                        })

            return {
                "results": records,
                "notifications": notifications,
            }
        except Exception as e:
            raise e  # Let outer handler manage exceptions


    def run_query_with_params(self, tx, query: str, params: dict = None):
        return tx.run(query, params or {}).data()