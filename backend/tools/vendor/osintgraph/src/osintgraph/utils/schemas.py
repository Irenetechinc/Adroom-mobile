from pydantic import BaseModel, Field


class SemanticCypherInput(BaseModel):
    cypher_template: str = Field(..., description="Cypher query containing $vector placeholder")
    query_text: str = Field(..., description="Keyword or phrase to embed for semantic search")

class GetTemplateDetailsInput(BaseModel):
    template_name: str = Field(..., description="Name of the template to retrieve details for.")

