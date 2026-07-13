namespace Demo.Authorization;

/// <summary>Groups permission-name constants under one owning type.</summary>
public static class PermissionRegistry
{
    /// <summary>Blog-area permission names, grouped by entity.</summary>
    public static class Blog
    {
        /// <summary>Permission names for posts.</summary>
        public static class Posts
        {
            internal const string Create = "Blog.Posts.Create";
            internal const string Delete = "Blog.Posts.Delete";
        }

        /// <summary>Permission names for tags.</summary>
        public static class Tags
        {
            internal const string Create = "Blog.Tags.Create";
        }
    }
}
