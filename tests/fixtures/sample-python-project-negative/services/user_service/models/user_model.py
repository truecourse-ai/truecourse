from sqlalchemy import Column, String, DateTime, Boolean, Integer, ForeignKey, func
from sqlalchemy.orm import relationship, DeclarativeBase


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True)
    email = Column(String, unique=True, nullable=False)
    name = Column(String, nullable=True)
    posts = relationship("Post", back_populates="author")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class Post(Base):
    __tablename__ = "posts"

    id = Column(String, primary_key=True)
    title = Column(String, nullable=False)
    content = Column(String, nullable=True)
    published = Column(Boolean, default=False)
    author_id = Column(String, ForeignKey("users.id"), nullable=False)
    author = relationship("User", back_populates="posts")
    created_at = Column(DateTime, server_default=func.now())


# Intentional violations for analysis rule testing:
# - Missing timestamps (no created_at/updated_at)
# - category_id has no FK relation (missing foreign key)
# - Overly nullable columns
# - Naming inconsistency: mixes snake_case (category_id) with camelCase (viewCount)
class Comment(Base):
    __tablename__ = "comments"

    id = Column(String, primary_key=True)
    body = Column(String, nullable=True)
    category_id = Column(String, nullable=True)
    post_id = Column(String, nullable=True)
    rating = Column(Integer, nullable=True)
    viewCount = Column(Integer, nullable=True)
    status = Column(String, default="draft")


# Another model with issues:
# - Missing timestamps
# - tag_id column with no FK relation
class PostTag(Base):
    __tablename__ = "post_tags"

    id = Column(String, primary_key=True)
    tag_id = Column(String, nullable=False)
    label = Column(String, nullable=True)
