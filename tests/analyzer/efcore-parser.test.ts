import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { FileAnalysis } from '@truecourse/shared'
import { detectDatabases } from '../../packages/analyzer/src/database-detector'
import type { Service } from '../../packages/analyzer/src/service-detector'
import {
  parseEfCoreProject,
  parseEfCoreSchema,
  type EfCoreProjectFile,
} from '../../packages/analyzer/src/schema-parsers/efcore'

function projectFile(
  filePath: string,
  content: string,
  options: Partial<EfCoreProjectFile> = {},
): EfCoreProjectFile {
  return {
    filePath,
    content,
    serviceName: 'Publishing',
    providerTypes: ['postgres'],
    ...options,
  }
}

describe('EF Core schema parser', () => {
  it('uses one canonical table and navigation-based relations for a same-file model', () => {
    const result = parseEfCoreSchema(`
      using Microsoft.EntityFrameworkCore;
      using System.ComponentModel.DataAnnotations;

      public class AppDbContext : DbContext
      {
        public DbSet<Article> Articles { get; set; }
        public DbSet<Account> Accounts => Set<Account>();
      }

      public class Account
      {
        [Key]
        public Guid Id { get; set; }
      }

      public class Article
      {
        [Key]
        public Guid Id { get; set; }
        public Guid OwnerId { get; set; }
        public Account Owner { get; set; }
        public Guid? ParentId { get; set; }
        public Article Parent { get; set; }
        public Guid PrincipalId { get; set; }
      }
    `)

    expect(result.tables.map((table) => table.name).sort()).toEqual(['Accounts', 'Articles'])
    const articleColumns = result.tables.find((table) => table.name === 'Articles')?.columns
    expect(articleColumns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'owner_id', isForeignKey: true, referencesTable: 'Accounts' }),
        expect.objectContaining({ name: 'parent_id', isForeignKey: true, referencesTable: 'Articles' }),
      ]),
    )
    const principalId = articleColumns?.find((column) => column.name === 'principal_id')
    expect(principalId).not.toHaveProperty('isForeignKey')
    expect(principalId).not.toHaveProperty('referencesTable')
    expect(result.relations).toEqual([
      {
        sourceTable: 'Articles',
        targetTable: 'Accounts',
        relationType: 'one-to-many',
        foreignKeyColumn: 'owner_id',
      },
      {
        sourceTable: 'Articles',
        targetTable: 'Articles',
        relationType: 'one-to-many',
        foreignKeyColumn: 'parent_id',
      },
    ])
  })

  it('honors explicit table names and ignores declaration-like text in comments and strings', () => {
    const result = parseEfCoreSchema(`
      using System.ComponentModel.DataAnnotations;
      using System.ComponentModel.DataAnnotations.Schema;

      // Stores a record of publishing actions and the class of actor involved.
      [Table("PublishedArticles")]
      public class Article
      {
        [Key]
        public Guid Id { get; set; }
        public string Description { get; set; } = "a record of class of examples";
      }
    `)

    expect(result.tables).toHaveLength(1)
    expect(result.tables[0]).toMatchObject({ name: 'PublishedArticles', primaryKey: 'id' })
  })

  it('ignores declaration-like text in raw strings with extended delimiters', () => {
    const result = parseEfCoreSchema(`
      using System.ComponentModel.DataAnnotations;
      using System.ComponentModel.DataAnnotations.Schema;

      public static class Copy
      {
        public const string Description = """" class of fake records """";
      }

      [Table("PublishedArticles")]
      public class Article
      {
        [Key]
        public Guid Id { get; set; }
      }
    `)

    expect(result.tables).toHaveLength(1)
    expect(result.tables[0].name).toBe('PublishedArticles')
  })

  it('supports attributes separated by comments and ForeignKey on a navigation property', () => {
    const result = parseEfCoreSchema(`
      using Microsoft.EntityFrameworkCore;
      using System.ComponentModel.DataAnnotations;
      using System.ComponentModel.DataAnnotations.Schema;

      public class AppDbContext : DbContext
      {
        public DbSet<Article> Articles { get; set; }
        public DbSet<Account> Accounts { get; set; }
      }

      public class Account { [Key] public Guid Id { get; set; } }

      [Table("PublishedArticles")]
      // The comment between the attribute and declaration is valid C#.
      public class Article
      {
        [Key]
        public Guid Id { get; set; }
        public Guid OwnerKey { get; set; }

        [ForeignKey(nameof(OwnerKey))]
        public Account Owner { get; set; }
      }
    `)

    expect(result.tables.find((table) => table.name === 'PublishedArticles')?.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'owner_key', referencesTable: 'Accounts' }),
      ]),
    )
    expect(result.relations).toContainEqual(
      expect.objectContaining({
        sourceTable: 'PublishedArticles',
        targetTable: 'Accounts',
        foreignKeyColumn: 'owner_key',
      }),
    )
  })

  it('ignores private DbSet fields outside a DbContext', () => {
    const result = parseEfCoreSchema(`
      public class AccountRepository
      {
        private readonly DbSet<Account> _dbSet;
      }
    `)

    expect(result).toEqual({ tables: [], relations: [] })
  })

  it('draws a collection-only one-to-many when the dependent side has no reference navigation', () => {
    const result = parseEfCoreSchema(`
      using Microsoft.EntityFrameworkCore;
      using System.ComponentModel.DataAnnotations;

      public class AppDbContext : DbContext
      {
        public DbSet<Order> Orders { get; set; }
        public DbSet<OrderLine> OrderLines { get; set; }
      }

      public class Order
      {
        [Key] public Guid Id { get; set; }
        public List<OrderLine> Lines { get; set; } = new();
      }

      public class OrderLine
      {
        [Key] public Guid Id { get; set; }
        public Guid OrderId { get; set; }
      }
    `)

    const orderLine = result.tables.find((table) => table.name === 'OrderLines')
    expect(orderLine?.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'order_id', isForeignKey: true, referencesTable: 'Orders' }),
      ]),
    )
    expect(result.relations).toContainEqual({
      sourceTable: 'OrderLines',
      targetTable: 'Orders',
      relationType: 'one-to-many',
      foreignKeyColumn: 'order_id',
    })
  })

  it('does not invent a target for a *Id scalar that names no modeled entity', () => {
    const result = parseEfCoreSchema(`
      using Microsoft.EntityFrameworkCore;
      using System.ComponentModel.DataAnnotations;

      public class AppDbContext : DbContext
      {
        public DbSet<Order> Orders { get; set; }
      }

      public class Order
      {
        [Key] public Guid Id { get; set; }
        public Guid TenantId { get; set; }
      }
    `)

    const tenant = result.tables
      .find((table) => table.name === 'Orders')
      ?.columns.find((column) => column.name === 'tenant_id')
    expect(tenant).not.toHaveProperty('isForeignKey')
    expect(tenant).not.toHaveProperty('referencesTable')
    expect(result.relations).toEqual([])
  })

  it('honors [ForeignKey] on a navigation for a scalar column ending in Id', () => {
    const result = parseEfCoreSchema(`
      using Microsoft.EntityFrameworkCore;
      using System.ComponentModel.DataAnnotations;
      using System.ComponentModel.DataAnnotations.Schema;

      public class AppDbContext : DbContext
      {
        public DbSet<Article> Articles { get; set; }
        public DbSet<Account> Accounts { get; set; }
      }

      public class Account { [Key] public Guid Id { get; set; } }

      public class Article
      {
        [Key] public Guid Id { get; set; }
        public Guid AuthorId { get; set; }

        [ForeignKey(nameof(AuthorId))]
        public Account Writer { get; set; }
      }
    `)

    const articleColumns = result.tables.find((table) => table.name === 'Articles')?.columns
    expect(articleColumns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'author_id', isForeignKey: true, referencesTable: 'Accounts' }),
      ]),
    )
    expect(result.relations).toContainEqual({
      sourceTable: 'Articles',
      targetTable: 'Accounts',
      relationType: 'one-to-many',
      foreignKeyColumn: 'author_id',
    })
  })

  it('keeps enum-typed properties as scalar columns instead of dropping them', () => {
    const result = parseEfCoreSchema(`
      using Microsoft.EntityFrameworkCore;
      using System.ComponentModel.DataAnnotations;

      public class AppDbContext : DbContext
      {
        public DbSet<Order> Orders { get; set; }
      }

      public class Order
      {
        [Key] public Guid Id { get; set; }
        public OrderStatus Status { get; set; }
      }

      public enum OrderStatus { Pending, Paid }
    `)

    const columns = result.tables.find((table) => table.name === 'Orders')?.columns
    expect(columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'status', type: 'OrderStatus' }),
      ]),
    )
    // The enum must not be mistaken for a navigation / relationship.
    expect(result.relations).toEqual([])
  })
})

describe('EF Core project reconciliation', () => {
  it('emits equivalent schemas for same-file and split-file models', () => {
    const context = `
      using Microsoft.EntityFrameworkCore;
      using Publishing.Domain;
      namespace Publishing.Data;

      public class AppDbContext : DbContext
      {
        public DbSet<Article> Articles { get; set; }
        public DbSet<Account> Accounts { get; set; }
      }
    `
    const entities = `
      namespace Publishing.Domain;

      public class Account
      {
        public Guid Id { get; set; }
      }

      public class Article
      {
        public Guid Id { get; set; }
        public Guid OwnerId { get; set; }
        public Account Owner { get; set; }
      }
    `

    const sameFile = parseEfCoreProject([
      projectFile('/repo/Model.cs', `${context}\n${entities}`),
    ])
    const splitFiles = parseEfCoreProject([
      projectFile('/repo/AppDbContext.cs', context),
      projectFile('/repo/Entities.cs', entities),
    ])

    expect(sameFile).toHaveLength(1)
    expect(splitFiles).toHaveLength(1)
    expect(splitFiles[0].tables).toEqual(sameFile[0].tables)
    expect(splitFiles[0].relations).toEqual(sameFile[0].relations)
  })

  it('reconciles split convention-only entities with their DbSet properties', () => {
    const results = parseEfCoreProject([
      projectFile('/repo/Data/AppDbContext.cs', `
        using Microsoft.EntityFrameworkCore;
        using Publishing.Domain;
        namespace Publishing.Data;

        public class AppDbContext : DbContext
        {
          public DbSet<Article> Articles { get; set; }
          public DbSet<Account> Accounts { get; set; }
        }
      `),
      projectFile('/repo/Domain/Article.cs', `
        namespace Publishing.Domain;
        public class Article
        {
          public Guid Id { get; set; }
          public Guid OwnerId { get; set; }
          public Account Owner { get; set; }
        }
      `),
      projectFile('/repo/Domain/Account.cs', `
        namespace Publishing.Domain;
        public class Account
        {
          public Guid Id { get; set; }
        }

        public class ArticleDto
        {
          public Guid Id { get; set; }
        }
      `),
    ])

    expect(results).toHaveLength(1)
    expect(results[0].dbType).toBe('postgres')
    expect(results[0].tables.map((table) => table.name).sort()).toEqual(['Accounts', 'Articles'])
    expect(results[0].tables.find((table) => table.name === 'Articles')?.columns.length).toBeGreaterThan(1)
    expect(results[0].relations).toEqual([
      {
        sourceTable: 'Articles',
        targetTable: 'Accounts',
        relationType: 'one-to-many',
        foreignKeyColumn: 'owner_id',
      },
    ])
  })

  it('applies active ToTable configuration before attribute and DbSet names', () => {
    const results = parseEfCoreProject([
      projectFile('/repo/AppDbContext.cs', `
        using Microsoft.EntityFrameworkCore;
        using Publishing.Domain;
        namespace Publishing.Data;

        public class AppDbContext : DbContext
        {
          public DbSet<Article> Articles { get; set; }

          protected override void OnModelCreating(ModelBuilder modelBuilder)
          {
            modelBuilder.Entity<Article>().ToTable("CurrentArticles");
          }
        }
      `),
      projectFile('/repo/Article.cs', `
        using System.ComponentModel.DataAnnotations;
        using System.ComponentModel.DataAnnotations.Schema;
        namespace Publishing.Domain;

        [Table("PublishedArticles")]
        public class Article
        {
          [Key]
          public Guid Id { get; set; }
        }
      `),
    ])

    expect(results[0].tables).toHaveLength(1)
    expect(results[0].tables[0].name).toBe('CurrentArticles')
  })

  it('parses active mappings without fixed source-length limits', () => {
    const spacing = ' '.repeat(1_200)
    const results = parseEfCoreProject([
      projectFile('/repo/AppDbContext.cs', `
        using Microsoft.EntityFrameworkCore;
        namespace Publishing;
        public class AppDbContext : DbContext
        {
          public DbSet<Article> Articles { get; set; }
          protected override void OnModelCreating(ModelBuilder modelBuilder)
          {
            modelBuilder.Entity<Article>().ToTable(${spacing}"LongFormArticles");
          }
        }
      `),
      projectFile('/repo/Article.cs', `
        using System.ComponentModel.DataAnnotations.Schema;
        namespace Publishing;
        [Table("PublishedArticles")]
        ${spacing}
        public class Article { public Guid Id { get; set; } }
      `),
    ])

    expect(results[0].tables).toHaveLength(1)
    expect(results[0].tables[0].name).toBe('LongFormArticles')
  })

  it('merges partial entity declarations before emitting columns', () => {
    const results = parseEfCoreProject([
      projectFile('/repo/AppDbContext.cs', `
        using Microsoft.EntityFrameworkCore;
        namespace Publishing;
        public class AppDbContext : DbContext
        {
          public DbSet<Article> Articles { get; set; }
        }
      `),
      projectFile('/repo/Article.Key.cs', `
        namespace Publishing;
        public partial class Article { public Guid Id { get; set; } }
      `),
      projectFile('/repo/Article.Fields.cs', `
        namespace Publishing;
        public partial class Article { public string Title { get; set; } }
      `),
    ])

    expect(results).toHaveLength(1)
    expect(results[0].tables).toHaveLength(1)
    expect(results[0].tables[0].columns.map((column) => column.name).sort()).toEqual([
      'id',
      'title',
    ])
  })

  it('merges partial DbContext declarations before applying table mappings', () => {
    const results = parseEfCoreProject([
      projectFile('/repo/AppDbContext.Sets.cs', `
        using Microsoft.EntityFrameworkCore;
        namespace Publishing;
        public partial class AppDbContext : DbContext
        {
          public DbSet<Article> Articles { get; set; }
        }
      `),
      projectFile('/repo/AppDbContext.Mapping.cs', `
        using Microsoft.EntityFrameworkCore;
        namespace Publishing;
        public partial class AppDbContext
        {
          protected override void OnModelCreating(ModelBuilder modelBuilder)
          {
            modelBuilder.Entity<Article>().ToTable("CurrentArticles");
          }
        }
      `),
      projectFile('/repo/Article.cs', `
        namespace Publishing;
        public class Article { public Guid Id { get; set; } }
      `),
    ])

    expect(results).toHaveLength(1)
    expect(results[0].contextName).toBe('Publishing.AppDbContext')
    expect(results[0].tables).toHaveLength(1)
    expect(results[0].tables[0].name).toBe('CurrentArticles')
  })

  it('recognizes DbContext inheritance through a service-local base class', () => {
    const results = parseEfCoreProject([
      projectFile('/repo/BaseContext.cs', `
        using Microsoft.EntityFrameworkCore;
        namespace Publishing;
        public abstract class BaseContext : DbContext
        {
          public DbSet<Account> Accounts { get; set; }
        }
      `),
      projectFile('/repo/AppDbContext.cs', `
        namespace Publishing;
        public class AppDbContext : BaseContext
        {
          public DbSet<Article> Articles { get; set; }
        }
      `),
      projectFile('/repo/Article.cs', `
        namespace Publishing;
        public class Account { public Guid Id { get; set; } }
        public class Article
        {
          public Guid Id { get; set; }
          public Guid OwnerId { get; set; }
          public Account Owner { get; set; }
        }
      `),
    ])

    expect(results).toHaveLength(1)
    expect(results[0].contextName).toBe('Publishing.AppDbContext')
    expect(results[0].tables.map((table) => table.name).sort()).toEqual(['Accounts', 'Articles'])
    expect(results[0].relations).toContainEqual({
      sourceTable: 'Articles',
      targetTable: 'Accounts',
      relationType: 'one-to-many',
      foreignKeyColumn: 'owner_id',
    })
  })

  it('uses an explicitly applied IEntityTypeConfiguration mapping', () => {
    const results = parseEfCoreProject([
      projectFile('/repo/AppDbContext.cs', `
        using Microsoft.EntityFrameworkCore;
        namespace Publishing;
        public class AppDbContext : DbContext
        {
          public DbSet<Article> Articles { get; set; }
          protected override void OnModelCreating(ModelBuilder modelBuilder)
          {
            modelBuilder.ApplyConfiguration(new ArticleConfiguration());
          }
        }
      `),
      projectFile('/repo/ArticleConfiguration.cs', `
        using Microsoft.EntityFrameworkCore;
        using Microsoft.EntityFrameworkCore.Metadata.Builders;
        namespace Publishing;
        public class ArticleConfiguration : IEntityTypeConfiguration<Article>
        {
          public void Configure(EntityTypeBuilder<Article> builder)
          {
            builder.ToTable("ConfiguredArticles");
          }
        }
      `),
      projectFile('/repo/Article.cs', `
        namespace Publishing;
        public class Article { public Guid Id { get; set; } }
      `),
    ])

    expect(results).toHaveLength(1)
    expect(results[0].tables).toHaveLength(1)
    expect(results[0].tables[0].name).toBe('ConfiguredArticles')
  })

  it('applies Table attributes before DbSet and convention names', () => {
    const results = parseEfCoreProject([
      projectFile('/repo/AppDbContext.cs', `
        using Microsoft.EntityFrameworkCore;
        namespace Publishing;
        public class AppDbContext : DbContext
        {
          public DbSet<Article> Articles { get; set; }
        }
      `),
      projectFile('/repo/Article.cs', `
        using System.ComponentModel.DataAnnotations.Schema;
        namespace Publishing;
        [Table("PublishedArticles")]
        public class Article { public Guid Id { get; set; } }
      `),
    ])

    expect(results[0].tables).toHaveLength(1)
    expect(results[0].tables[0].name).toBe('PublishedArticles')
  })

  it.each([
    ['postgres', 'postgres'],
    ['sqlserver', 'sqlserver'],
    ['mysql', 'mysql'],
    ['sqlite', 'sqlite'],
  ] as const)('keeps split entity schema with its %s provider', (_name, provider) => {
    const results = parseEfCoreProject([
      projectFile('/repo/AppDbContext.cs', `
        using Microsoft.EntityFrameworkCore;
        namespace Publishing.Data;
        public class AppDbContext : DbContext
        {
          public DbSet<Article> Articles { get; set; }
        }
      `, { providerTypes: [provider] }),
      projectFile('/repo/Article.cs', `
        using System.ComponentModel.DataAnnotations;
        namespace Publishing.Data;
        public class Article
        {
          [Key]
          public Guid Id { get; set; }
        }
      `, { providerTypes: [provider] }),
    ])

    expect(results).toHaveLength(1)
    expect(results[0].dbType).toBe(provider)
    expect(results[0].tables[0]).toMatchObject({ name: 'Articles', primaryKey: 'id' })
  })

  it('associates AddDbContext provider setup with the referenced model', () => {
    const providerTypes = ['postgres', 'sqlserver'] as const
    const options = { providerTypes: [...providerTypes] }
    const results = parseEfCoreProject([
      projectFile('/repo/Program.cs', `
        services.AddDbContext<SalesContext>(options => options.UseNpgsql(connectionString));
        services.AddDbContext<SupportContext>(options => options.UseSqlServer(connectionString));
      `, options),
      projectFile('/repo/SalesContext.cs', `
        using Microsoft.EntityFrameworkCore;
        namespace Publishing;
        public class SalesContext : DbContext
        {
          public DbSet<Sale> Sales { get; set; }
        }
        public class Sale { public Guid Id { get; set; } }
      `, options),
      projectFile('/repo/SupportContext.cs', `
        using Microsoft.EntityFrameworkCore;
        namespace Publishing;
        public class SupportContext : DbContext
        {
          public DbSet<Ticket> Tickets { get; set; }
        }
        public class Ticket { public Guid Id { get; set; } }
      `, options),
    ])

    expect(results).toHaveLength(2)
    expect(results.find((result) => result.contextName?.endsWith('SalesContext'))?.dbType)
      .toBe('postgres')
    expect(results.find((result) => result.contextName?.endsWith('SupportContext'))?.dbType)
      .toBe('sqlserver')
  })

  it('leaves an ambiguous provider unresolved instead of guessing PostgreSQL', () => {
    const results = parseEfCoreProject([
      projectFile('/repo/AppDbContext.cs', `
        using Microsoft.EntityFrameworkCore;
        namespace Publishing;
        public class AppDbContext : DbContext
        {
          public DbSet<Article> Articles { get; set; }
        }
        public class Article { public Guid Id { get; set; } }
      `, { providerTypes: ['postgres', 'sqlserver'] }),
    ])

    expect(results).toHaveLength(1)
    expect(results[0].dbType).toBeNull()
  })

  it('does not merge same-named entities from different model scopes', () => {
    const results = parseEfCoreProject([
      projectFile('/repo/SalesContext.cs', `
        using Microsoft.EntityFrameworkCore;
        namespace Sales;
        public class SalesContext : DbContext
        {
          public DbSet<Sales.Customer> SalesCustomers { get; set; }
        }
        public class Customer { public Guid Id { get; set; } }
      `),
      projectFile('/repo/SupportContext.cs', `
        using Microsoft.EntityFrameworkCore;
        namespace Support;
        public class SupportContext : DbContext
        {
          public DbSet<Support.Customer> SupportCustomers { get; set; }
        }
        public class Customer { public Guid Id { get; set; } }
      `),
    ])

    expect(results).toHaveLength(2)
    expect(results.flatMap((result) => result.tables.map((table) => table.name)).sort()).toEqual([
      'SalesCustomers',
      'SupportCustomers',
    ])
  })

  it('collects convention-only entity files from a detected EF service', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'truecourse-efcore-project-'))
    try {
      const contextPath = path.join(root, 'AppDbContext.cs')
      const entityPath = path.join(root, 'Article.cs')
      fs.writeFileSync(path.join(root, 'Publishing.csproj'), `
        <Project Sdk="Microsoft.NET.Sdk">
          <ItemGroup>
            <PackageReference Include="Npgsql.EntityFrameworkCore.PostgreSQL" Version="9.0.0" />
          </ItemGroup>
        </Project>
      `)
      fs.writeFileSync(contextPath, `
        using Microsoft.EntityFrameworkCore;
        namespace Publishing;
        public class AppDbContext : DbContext
        {
          public DbSet<Article> Articles { get; set; }
        }
      `)
      fs.writeFileSync(entityPath, `
        namespace Publishing;
        public class Article
        {
          public Guid Id { get; set; }
          public string Title { get; set; }
        }
      `)

      const analyses = [
        {
          filePath: contextPath,
          language: 'csharp',
          imports: [{ source: 'Microsoft.EntityFrameworkCore' }],
        },
        {
          filePath: entityPath,
          language: 'csharp',
          imports: [],
        },
      ] as unknown as FileAnalysis[]
      const services = [{
        name: 'Publishing',
        rootPath: root,
        files: [contextPath, entityPath],
      }] as unknown as Service[]

      const detected = detectDatabases(root, analyses, services)
      const postgres = detected.databases.find((database) => database.type === 'postgres')

      expect(postgres?.tables).toHaveLength(1)
      expect(postgres?.tables[0]).toMatchObject({
        name: 'Articles',
        columns: expect.arrayContaining([
          expect.objectContaining({ name: 'title', type: 'string' }),
        ]),
      })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('collects top-level provider setup and keeps detector schemas model-scoped', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'truecourse-efcore-providers-'))
    try {
      const files = new Map([
        [path.join(root, 'Program.cs'), `
          using Microsoft.EntityFrameworkCore;
          services.AddDbContext<SalesContext>(options => options.UseNpgsql(pgConnection));
          services.AddDbContext<SupportContext>(options => options.UseSqlServer(sqlConnection));
        `],
        [path.join(root, 'SalesContext.cs'), `
          using Microsoft.EntityFrameworkCore;
          namespace Publishing;
          public class SalesContext : DbContext
          {
            public DbSet<Sale> Sales { get; set; }
          }
          public class Sale { public Guid Id { get; set; } }
        `],
        [path.join(root, 'SupportContext.cs'), `
          using Microsoft.EntityFrameworkCore;
          namespace Publishing;
          public class SupportContext : DbContext
          {
            public DbSet<Ticket> Tickets { get; set; }
          }
          public class Ticket { public Guid Id { get; set; } }
        `],
      ])
      fs.writeFileSync(path.join(root, 'Publishing.csproj'), `
        <Project Sdk="Microsoft.NET.Sdk">
          <ItemGroup>
            <PackageReference Include="Npgsql.EntityFrameworkCore.PostgreSQL" Version="9.0.0" />
            <PackageReference Include="Microsoft.EntityFrameworkCore.SqlServer" Version="9.0.0" />
          </ItemGroup>
        </Project>
      `)
      for (const [filePath, content] of files) fs.writeFileSync(filePath, content)

      const analyses = [...files.keys()].map((filePath) => ({
        filePath,
        language: 'csharp',
        imports: filePath.endsWith('Program.cs') || filePath.endsWith('Context.cs')
          ? [{ source: 'Microsoft.EntityFrameworkCore' }]
          : [],
      })) as unknown as FileAnalysis[]
      const services = [{
        name: 'Publishing',
        rootPath: root,
        files: [...files.keys()],
      }] as unknown as Service[]

      const detected = detectDatabases(root, analyses, services)
      expect(detected.databases.find((database) => database.type === 'postgres')?.tables)
        .toEqual([expect.objectContaining({ name: 'Sales' })])
      expect(detected.databases.find((database) => database.type === 'sqlserver')?.tables)
        .toEqual([expect.objectContaining({ name: 'Tickets' })])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('reconciles entities and context that live outside any detected service (Clean Architecture)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'truecourse-efcore-cleanarch-'))
    try {
      const web = path.join(root, 'src', 'Web')
      const write = (filePath: string, content: string): string => {
        fs.mkdirSync(path.dirname(filePath), { recursive: true })
        fs.writeFileSync(filePath, content)
        return filePath
      }
      // Only Web is a detected service; it carries the provider package and the
      // entrypoint. The DbContext and entity POCOs live in class libraries that
      // are NOT detected services, so they fall into the shared root scope.
      write(path.join(web, 'Web.csproj'), `
        <Project Sdk="Microsoft.NET.Sdk">
          <ItemGroup>
            <PackageReference Include="Microsoft.EntityFrameworkCore.SqlServer" Version="8.0.0" />
          </ItemGroup>
        </Project>
      `)
      const program = write(path.join(web, 'Program.cs'), `
        using Microsoft.EntityFrameworkCore;
        var app = builder.Build();
      `)
      const context = write(path.join(root, 'src', 'Infrastructure', 'CatalogContext.cs'), `
        using Microsoft.EntityFrameworkCore;
        using ApplicationCore.Entities;
        namespace Infrastructure.Data;
        public class CatalogContext : DbContext
        {
          public DbSet<CatalogItem> CatalogItems { get; set; }
          public DbSet<CatalogBrand> CatalogBrands { get; set; }
          protected override void OnConfiguring(DbContextOptionsBuilder o) { o.UseSqlServer("conn"); }
        }
      `)
      // Pure POCOs — no EF import of their own; they carry the columns.
      const item = write(path.join(root, 'src', 'ApplicationCore', 'CatalogItem.cs'), `
        namespace ApplicationCore.Entities;
        public class CatalogItem
        {
          public int Id { get; set; }
          public string Name { get; set; }
          public int CatalogBrandId { get; set; }
          public CatalogBrand CatalogBrand { get; set; }
        }
      `)
      const brand = write(path.join(root, 'src', 'ApplicationCore', 'CatalogBrand.cs'), `
        namespace ApplicationCore.Entities;
        public class CatalogBrand { public int Id { get; set; } public string Brand { get; set; } }
      `)

      const analyses = [
        { filePath: program, language: 'csharp', imports: [{ source: 'Microsoft.EntityFrameworkCore' }] },
        { filePath: context, language: 'csharp', imports: [{ source: 'Microsoft.EntityFrameworkCore' }] },
        { filePath: item, language: 'csharp', imports: [] },
        { filePath: brand, language: 'csharp', imports: [] },
      ] as unknown as FileAnalysis[]
      const services = [{ name: 'Web', rootPath: web, files: [program] }] as unknown as Service[]

      const sqlserver = detectDatabases(root, analyses, services).databases
        .find((database) => database.type === 'sqlserver')
      const items = sqlserver?.tables.find((table) => table.name === 'CatalogItems')

      // The property-bearing POCOs reach the parser, so tables carry columns
      // and the FK is drawn — not empty DbSet stubs.
      expect(items?.columns.map((column) => column.name)).toEqual(['id', 'name', 'catalog_brand_id'])
      expect(sqlserver?.relations).toContainEqual(
        expect.objectContaining({
          sourceTable: 'CatalogItems',
          targetTable: 'CatalogBrands',
          foreignKeyColumn: 'catalog_brand_id',
        }),
      )
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('resolves an AddDbContext provider hint against a context in another model scope', () => {
    const results = parseEfCoreProject([
      projectFile('/repo/Web/Program.cs', `
        using Microsoft.EntityFrameworkCore;
        builder.Services.AddDbContext<CatalogContext>(c => c.UseSqlServer(connectionString));
      `, { serviceName: 'Web', providerTypes: [] }),
      projectFile('/repo/Infrastructure/CatalogContext.cs', `
        using Microsoft.EntityFrameworkCore;
        namespace Shop.Infrastructure;
        public class CatalogContext : DbContext
        {
          public DbSet<Product> Products { get; set; }
        }
      `, { serviceName: '__root__', providerTypes: [] }),
      projectFile('/repo/Infrastructure/Product.cs', `
        namespace Shop.Infrastructure;
        public class Product { public Guid Id { get; set; } }
      `, { serviceName: '__root__', providerTypes: [] }),
    ])

    expect(results).toHaveLength(1)
    expect(results[0].contextName).toBe('Shop.Infrastructure.CatalogContext')
    expect(results[0].tables.length).toBeGreaterThan(0)
    expect(results[0].dbType).toBe('sqlserver')
  })

  it('does not resolve an unqualified AddDbContext hint when two contexts share a name', () => {
    const results = parseEfCoreProject([
      projectFile('/repo/Program.cs', `
        using Microsoft.EntityFrameworkCore;
        builder.Services.AddDbContext<AppDbContext>(c => c.UseSqlServer(connectionString));
      `, { serviceName: 'Web', providerTypes: [] }),
      projectFile('/repo/Sales/SalesModel.cs', `
        using Microsoft.EntityFrameworkCore;
        namespace Sales;
        public class AppDbContext : DbContext { public DbSet<Sale> Sales { get; set; } }
        public class Sale { public Guid Id { get; set; } }
      `, { serviceName: 'Sales', providerTypes: [] }),
      projectFile('/repo/Support/SupportModel.cs', `
        using Microsoft.EntityFrameworkCore;
        namespace Support;
        public class AppDbContext : DbContext { public DbSet<Ticket> Tickets { get; set; } }
        public class Ticket { public Guid Id { get; set; } }
      `, { serviceName: 'Support', providerTypes: [] }),
    ])

    expect(results).toHaveLength(2)
    for (const result of results) expect(result.dbType).toBeNull()
  })

  it('falls back to a repo-wide unique EF provider for a context outside every service', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'truecourse-efcore-fallback-'))
    try {
      const web = path.join(root, 'src', 'Web')
      const write = (filePath: string, content: string): string => {
        fs.mkdirSync(path.dirname(filePath), { recursive: true })
        fs.writeFileSync(filePath, content)
        return filePath
      }
      // Only Web is a detected service; it carries the provider package. Unlike
      // the Clean Architecture test above there is NO OnConfiguring and NO
      // AddDbContext hint, so the provider is known only from the package.
      write(path.join(web, 'Web.csproj'), `
        <Project Sdk="Microsoft.NET.Sdk">
          <ItemGroup>
            <PackageReference Include="Microsoft.EntityFrameworkCore.SqlServer" Version="8.0.0" />
          </ItemGroup>
        </Project>
      `)
      const program = write(path.join(web, 'Program.cs'), `
        using Microsoft.EntityFrameworkCore;
        var app = builder.Build();
      `)
      const context = write(path.join(root, 'src', 'Infrastructure', 'CatalogContext.cs'), `
        using Microsoft.EntityFrameworkCore;
        using ApplicationCore.Entities;
        namespace Infrastructure.Data;
        public class CatalogContext : DbContext
        {
          public DbSet<CatalogItem> CatalogItems { get; set; }
        }
      `)
      const item = write(path.join(root, 'src', 'ApplicationCore', 'CatalogItem.cs'), `
        namespace ApplicationCore.Entities;
        public class CatalogItem
        {
          public int Id { get; set; }
          public string Name { get; set; }
        }
      `)

      const analyses = [
        { filePath: program, language: 'csharp', imports: [{ source: 'Microsoft.EntityFrameworkCore' }] },
        { filePath: context, language: 'csharp', imports: [{ source: 'Microsoft.EntityFrameworkCore' }] },
        { filePath: item, language: 'csharp', imports: [] },
      ] as unknown as FileAnalysis[]
      const services = [{ name: 'Web', rootPath: web, files: [program] }] as unknown as Service[]

      const sqlserver = detectDatabases(root, analyses, services).databases
        .find((database) => database.type === 'sqlserver')
      const items = sqlserver?.tables.find((table) => table.name === 'CatalogItems')

      expect(items?.columns.map((column) => column.name)).toEqual(['id', 'name'])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
