/**
 * Unit tests for `_shared/python-framework-detection.ts`.
 *
 * Tested in isolation BEFORE any visitor uses them — same pattern as the JS
 * helpers in `tests/analyzer/framework-detection.test.ts`.
 */
import { describe, it, expect } from 'vitest'
import { parseCode } from '../../packages/analyzer/src/parser'
import {
  getPythonImportSources,
  detectPythonOrm,
  detectPythonWebFramework,
  detectPythonDataLib,
  importsAwsSdk,
  importsPydantic,
  importsFastApi,
  importsPandas,
  importsNumpy,
  importsDjango,
  importsSqlAlchemy,
  isFastApiDependsCall,
  isPydanticFieldCall,
  isPydanticModelClass,
  isDjangoModelClass,
  isPythonAuthDecoratorName,
  isSqlAlchemyColumnCall,
  isSqlAlchemyMappedAnnotation,
} from '../../packages/analyzer/src/rules/_shared/python-framework-detection'
import type { SyntaxNode } from 'tree-sitter'

function root(code: string): SyntaxNode {
  return parseCode(code, 'python').rootNode
}

function firstNodeOfType(n: SyntaxNode, type: string): SyntaxNode | null {
  if (n.type === type) return n
  for (const child of n.namedChildren) {
    const found = firstNodeOfType(child, type)
    if (found) return found
  }
  return null
}

// ---------------------------------------------------------------------------
// getPythonImportSources
// ---------------------------------------------------------------------------

describe('getPythonImportSources', () => {
  it('handles plain `import x`', () => {
    const sources = getPythonImportSources(root(`import os`))
    expect(sources.has('os')).toBe(true)
  })

  it('handles `import x.y` (dotted)', () => {
    const sources = getPythonImportSources(root(`import os.path`))
    expect(sources.has('os.path')).toBe(true)
  })

  it('handles `import x as y`', () => {
    const sources = getPythonImportSources(root(`import os as o`))
    expect(sources.has('os')).toBe(true)
  })

  it('handles `import a, b, c` (multiple in one statement)', () => {
    const sources = getPythonImportSources(root(`import os, sys, json`))
    expect(sources.has('os')).toBe(true)
    expect(sources.has('sys')).toBe(true)
    expect(sources.has('json')).toBe(true)
  })

  it('handles `from x import y`', () => {
    const sources = getPythonImportSources(root(`from os import path`))
    expect(sources.has('os')).toBe(true)
  })

  it('handles `from x.y import z`', () => {
    const sources = getPythonImportSources(root(`from os.path import join`))
    expect(sources.has('os.path')).toBe(true)
  })

  it('handles relative imports `from . import x`', () => {
    const sources = getPythonImportSources(root(`from . import x`))
    expect(sources.has('.')).toBe(true)
  })

  it('handles relative imports `from .module import y`', () => {
    const sources = getPythonImportSources(root(`from .module import y`))
    expect(sources.has('.module')).toBe(true)
  })

  it('handles relative imports `from ..pkg import z`', () => {
    const sources = getPythonImportSources(root(`from ..pkg import z`))
    expect(sources.has('..pkg')).toBe(true)
  })

  it('does NOT include imported names — only sources', () => {
    const sources = getPythonImportSources(root(`from os.path import join`))
    expect(sources.has('join')).toBe(false)
  })

  it('does NOT include strings or comments', () => {
    const sources = getPythonImportSources(root(`# import faketext\nx = "import notreal"`))
    expect(sources.has('faketext')).toBe(false)
    expect(sources.has('notreal')).toBe(false)
  })

  it('returns the same set for multiple calls on the same root (cached)', () => {
    const r = root(`import os`)
    const a = getPythonImportSources(r)
    const b = getPythonImportSources(r)
    expect(a).toBe(b)
  })

  it('returns the same set for descendant nodes (cache key is module root)', () => {
    const r = root(`
import os
def f():
    return os.getcwd()
`)
    const inner = firstNodeOfType(r, 'call')!
    const outer = getPythonImportSources(r)
    const fromInner = getPythonImportSources(inner)
    expect(outer).toBe(fromInner)
  })
})

// ---------------------------------------------------------------------------
// detectPythonOrm
// ---------------------------------------------------------------------------

describe('detectPythonOrm', () => {
  it('detects sqlalchemy from top-level import', () => {
    expect(detectPythonOrm(root(`import sqlalchemy`))).toBe('sqlalchemy')
  })

  it('detects sqlalchemy from sub-module import', () => {
    expect(detectPythonOrm(root(`from sqlalchemy.orm import Session`))).toBe('sqlalchemy')
  })

  it('detects sqlmodel as sqlalchemy', () => {
    expect(detectPythonOrm(root(`from sqlmodel import Field, SQLModel`))).toBe('sqlalchemy')
  })

  it('detects django via django.db', () => {
    expect(detectPythonOrm(root(`from django.db import models`))).toBe('django')
  })

  it('detects tortoise', () => {
    expect(detectPythonOrm(root(`from tortoise.models import Model`))).toBe('tortoise')
  })

  it('detects peewee', () => {
    expect(detectPythonOrm(root(`from peewee import Model, CharField`))).toBe('peewee')
  })

  it('returns unknown when no ORM imported', () => {
    expect(detectPythonOrm(root(`import os`))).toBe('unknown')
  })

  it('does NOT match substring `requests` against `rest`', () => {
    expect(detectPythonOrm(root(`import requests`))).toBe('unknown')
  })

  it('does NOT match a string literal containing sqlalchemy', () => {
    expect(detectPythonOrm(root(`x = "sqlalchemy is great"`))).toBe('unknown')
  })
})

// ---------------------------------------------------------------------------
// detectPythonWebFramework
// ---------------------------------------------------------------------------

describe('detectPythonWebFramework', () => {
  it('detects fastapi', () => {
    expect(detectPythonWebFramework(root(`from fastapi import FastAPI`))).toBe('fastapi')
  })

  it('detects flask', () => {
    expect(detectPythonWebFramework(root(`from flask import Flask`))).toBe('flask')
  })

  it('detects flask_restful as flask', () => {
    expect(detectPythonWebFramework(root(`from flask_restful import Api`))).toBe('flask')
  })

  it('detects django', () => {
    expect(detectPythonWebFramework(root(`from django.urls import path`))).toBe('django')
  })

  it('detects starlette when imported alone', () => {
    expect(detectPythonWebFramework(root(`from starlette.responses import JSONResponse`))).toBe('starlette')
  })

  it('prefers fastapi over starlette when both are imported', () => {
    // FastAPI projects often import from both — fastapi should win.
    expect(
      detectPythonWebFramework(
        root(`
from starlette.responses import JSONResponse
from fastapi import FastAPI
`),
      ),
    ).toBe('fastapi')
  })

  it('detects aiohttp', () => {
    expect(detectPythonWebFramework(root(`from aiohttp import web`))).toBe('aiohttp')
  })

  it('detects tornado', () => {
    expect(detectPythonWebFramework(root(`import tornado.web`))).toBe('tornado')
  })

  it('detects sanic', () => {
    expect(detectPythonWebFramework(root(`from sanic import Sanic`))).toBe('sanic')
  })

  it('detects bottle', () => {
    expect(detectPythonWebFramework(root(`from bottle import route`))).toBe('bottle')
  })

  it('returns unknown when no web framework imported', () => {
    expect(detectPythonWebFramework(root(`import os`))).toBe('unknown')
  })
})

// ---------------------------------------------------------------------------
// detectPythonDataLib
// ---------------------------------------------------------------------------

describe('detectPythonDataLib', () => {
  it('detects pandas', () => {
    expect(detectPythonDataLib(root(`import pandas as pd`))).toBe('pandas')
  })

  it('detects polars', () => {
    expect(detectPythonDataLib(root(`import polars as pl`))).toBe('polars')
  })

  it('detects numpy', () => {
    expect(detectPythonDataLib(root(`import numpy as np`))).toBe('numpy')
  })

  it('detects pandas via sub-module', () => {
    expect(detectPythonDataLib(root(`from pandas.api.types import is_numeric_dtype`))).toBe('pandas')
  })

  it('returns unknown when no data lib imported', () => {
    expect(detectPythonDataLib(root(`import os`))).toBe('unknown')
  })
})

// ---------------------------------------------------------------------------
// importsX predicates
// ---------------------------------------------------------------------------

describe('importsAwsSdk', () => {
  it('detects boto3', () => {
    expect(importsAwsSdk(root(`import boto3`))).toBe(true)
  })

  it('detects boto3 sub-modules', () => {
    expect(importsAwsSdk(root(`from boto3.dynamodb.conditions import Key`))).toBe(true)
  })

  it('detects aiobotocore', () => {
    expect(importsAwsSdk(root(`from aiobotocore.session import get_session`))).toBe(true)
  })

  it('detects botocore', () => {
    expect(importsAwsSdk(root(`from botocore.exceptions import ClientError`))).toBe(true)
  })

  it('returns false when no AWS SDK imported', () => {
    expect(importsAwsSdk(root(`import os`))).toBe(false)
  })
})

describe('importsPydantic', () => {
  it('detects pydantic', () => {
    expect(importsPydantic(root(`from pydantic import BaseModel`))).toBe(true)
  })

  it('detects pydantic_settings', () => {
    expect(importsPydantic(root(`from pydantic_settings import BaseSettings`))).toBe(true)
  })

  it('returns false when no pydantic imported', () => {
    expect(importsPydantic(root(`import os`))).toBe(false)
  })
})

describe('importsFastApi', () => {
  it('detects fastapi', () => {
    expect(importsFastApi(root(`from fastapi import FastAPI`))).toBe(true)
  })

  it('returns false when no fastapi imported', () => {
    expect(importsFastApi(root(`from flask import Flask`))).toBe(false)
  })
})

describe('importsPandas', () => {
  it('detects pandas', () => {
    expect(importsPandas(root(`import pandas as pd`))).toBe(true)
  })

  it('returns false when no pandas imported', () => {
    expect(importsPandas(root(`import polars`))).toBe(false)
  })
})

describe('importsNumpy', () => {
  it('detects numpy', () => {
    expect(importsNumpy(root(`import numpy as np`))).toBe(true)
  })

  it('returns false when no numpy imported', () => {
    expect(importsNumpy(root(`import pandas`))).toBe(false)
  })
})

describe('importsDjango', () => {
  it('detects django', () => {
    expect(importsDjango(root(`from django.db import models`))).toBe(true)
  })

  it('returns false when no django imported', () => {
    expect(importsDjango(root(`from flask import Flask`))).toBe(false)
  })
})

describe('importsSqlAlchemy', () => {
  it('detects sqlalchemy', () => {
    expect(importsSqlAlchemy(root(`from sqlalchemy.orm import Session`))).toBe(true)
  })

  it('detects sqlmodel', () => {
    expect(importsSqlAlchemy(root(`from sqlmodel import SQLModel`))).toBe(true)
  })

  it('returns false when no sqlalchemy imported', () => {
    expect(importsSqlAlchemy(root(`from peewee import Model`))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isFastApiDependsCall
// ---------------------------------------------------------------------------

describe('isFastApiDependsCall', () => {
  function callOf(code: string): SyntaxNode {
    return firstNodeOfType(root(code), 'call')!
  }

  it('matches Depends(get_db)', () => {
    expect(isFastApiDependsCall(callOf(`def f(db = Depends(get_db)): pass`))).toBe(true)
  })

  it('matches fastapi.Depends(get_db)', () => {
    expect(isFastApiDependsCall(callOf(`def f(db = fastapi.Depends(get_db)): pass`))).toBe(true)
  })

  it('matches Query(...)', () => {
    expect(isFastApiDependsCall(callOf(`def f(q = Query(default=None)): pass`))).toBe(true)
  })

  it('matches Body(...)', () => {
    expect(isFastApiDependsCall(callOf(`def f(b = Body(...)): pass`))).toBe(true)
  })

  it('matches Path(...)', () => {
    expect(isFastApiDependsCall(callOf(`def f(p = Path(...)): pass`))).toBe(true)
  })

  it('matches Header(...)', () => {
    expect(isFastApiDependsCall(callOf(`def f(h = Header(None)): pass`))).toBe(true)
  })

  it('matches Cookie / Form / File / Security', () => {
    expect(isFastApiDependsCall(callOf(`def f(c = Cookie(None)): pass`))).toBe(true)
    expect(isFastApiDependsCall(callOf(`def f(c = Form(None)): pass`))).toBe(true)
    expect(isFastApiDependsCall(callOf(`def f(c = File(...)): pass`))).toBe(true)
    expect(isFastApiDependsCall(callOf(`def f(c = Security(get_user)): pass`))).toBe(true)
  })

  it('does NOT match a similarly-named user function MyDepends()', () => {
    expect(isFastApiDependsCall(callOf(`def f(x = MyDepends()): pass`))).toBe(false)
  })

  it('does NOT match the bare get_db() call', () => {
    expect(isFastApiDependsCall(callOf(`def f(db = get_db()): pass`))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isPydanticFieldCall
// ---------------------------------------------------------------------------

describe('isPydanticFieldCall', () => {
  function callOf(code: string): SyntaxNode {
    return firstNodeOfType(root(code), 'call')!
  }

  it('matches Field(default=...)', () => {
    expect(isPydanticFieldCall(callOf(`name: str = Field(default='x')`))).toBe(true)
  })

  it('matches PrivateAttr()', () => {
    expect(isPydanticFieldCall(callOf(`_x: int = PrivateAttr()`))).toBe(true)
  })

  it('matches pydantic.Field(...)', () => {
    expect(isPydanticFieldCall(callOf(`name: str = pydantic.Field(default='x')`))).toBe(true)
  })

  it('does NOT match an unrelated call', () => {
    expect(isPydanticFieldCall(callOf(`x = make_field()`))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isPydanticModelClass
// ---------------------------------------------------------------------------

describe('isPydanticModelClass', () => {
  function classOf(code: string): SyntaxNode {
    return firstNodeOfType(root(code), 'class_definition')!
  }

  it('matches class User(BaseModel)', () => {
    expect(isPydanticModelClass(classOf(`class User(BaseModel): pass`))).toBe(true)
  })

  it('matches class User(pydantic.BaseModel)', () => {
    expect(isPydanticModelClass(classOf(`class User(pydantic.BaseModel): pass`))).toBe(true)
  })

  it('matches class Settings(BaseSettings)', () => {
    expect(isPydanticModelClass(classOf(`class Settings(BaseSettings): pass`))).toBe(true)
  })

  it('matches class Container(GenericModel)', () => {
    expect(isPydanticModelClass(classOf(`class Container(GenericModel): pass`))).toBe(true)
  })

  it('matches class User(BaseModel, MyMixin) (multiple inheritance)', () => {
    expect(isPydanticModelClass(classOf(`class User(BaseModel, MyMixin): pass`))).toBe(true)
  })

  it('matches subscripted class Container(BaseModel[str])', () => {
    expect(isPydanticModelClass(classOf(`class Container(BaseModel[str]): pass`))).toBe(true)
  })

  it('does NOT match class User(SQLAlchemyBase)', () => {
    expect(isPydanticModelClass(classOf(`class User(SQLAlchemyBase): pass`))).toBe(false)
  })

  it('does NOT match class without superclasses', () => {
    expect(isPydanticModelClass(classOf(`class User: pass`))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isDjangoModelClass
// ---------------------------------------------------------------------------

describe('isDjangoModelClass', () => {
  function classOf(code: string): SyntaxNode {
    return firstNodeOfType(root(code), 'class_definition')!
  }

  it('matches class User(models.Model)', () => {
    expect(isDjangoModelClass(classOf(`class User(models.Model): pass`))).toBe(true)
  })

  it('matches class User(Model)', () => {
    expect(isDjangoModelClass(classOf(`class User(Model): pass`))).toBe(true)
  })

  it('matches class User(AbstractUser)', () => {
    expect(isDjangoModelClass(classOf(`class User(AbstractUser): pass`))).toBe(true)
  })

  it('matches class User(AbstractBaseUser, PermissionsMixin)', () => {
    expect(isDjangoModelClass(classOf(`class User(AbstractBaseUser, PermissionsMixin): pass`))).toBe(true)
  })

  it('does NOT match class User(BaseModel) (Pydantic)', () => {
    expect(isDjangoModelClass(classOf(`class User(BaseModel): pass`))).toBe(false)
  })

  it('does NOT match class without superclasses', () => {
    expect(isDjangoModelClass(classOf(`class User: pass`))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isSqlAlchemyColumnCall
// ---------------------------------------------------------------------------

describe('isSqlAlchemyColumnCall', () => {
  function callOf(code: string): SyntaxNode {
    return firstNodeOfType(root(code), 'call')!
  }

  it('matches mapped_column(...)', () => {
    expect(isSqlAlchemyColumnCall(callOf(`id = mapped_column(Integer, primary_key=True)`))).toBe(true)
  })

  it('matches Column(...)', () => {
    expect(isSqlAlchemyColumnCall(callOf(`id = Column(Integer, primary_key=True)`))).toBe(true)
  })

  it('matches relationship(...)', () => {
    expect(isSqlAlchemyColumnCall(callOf(`children = relationship("Child")`))).toBe(true)
  })

  it('matches qualified orm.mapped_column(...)', () => {
    expect(isSqlAlchemyColumnCall(callOf(`id = orm.mapped_column(Integer)`))).toBe(true)
  })

  it('does NOT match unrelated call', () => {
    expect(isSqlAlchemyColumnCall(callOf(`id = make_id()`))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isSqlAlchemyMappedAnnotation
// ---------------------------------------------------------------------------

describe('isSqlAlchemyMappedAnnotation', () => {
  /** Find the `type` child of a top-level assignment. */
  function annotationOf(code: string): SyntaxNode {
    const r = root(code)
    const assignment = firstNodeOfType(r, 'assignment')!
    return assignment.childForFieldName('type')!
  }

  it('matches Mapped[int]', () => {
    expect(isSqlAlchemyMappedAnnotation(annotationOf(`id: Mapped[int] = 1`))).toBe(true)
  })

  it('matches Mapped[Optional[str]]', () => {
    expect(isSqlAlchemyMappedAnnotation(annotationOf(`name: Mapped[Optional[str]] = None`))).toBe(true)
  })

  it('matches qualified orm.Mapped[int]', () => {
    expect(isSqlAlchemyMappedAnnotation(annotationOf(`id: orm.Mapped[int] = 1`))).toBe(true)
  })

  it('does NOT match plain int annotation', () => {
    expect(isSqlAlchemyMappedAnnotation(annotationOf(`id: int = 1`))).toBe(false)
  })

  it('does NOT match Optional[int]', () => {
    expect(isSqlAlchemyMappedAnnotation(annotationOf(`id: Optional[int] = None`))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isPythonAuthDecoratorName
// ---------------------------------------------------------------------------

describe('isPythonAuthDecoratorName', () => {
  it.each([
    'login_required',
    'permission_required',
    'user_passes_test',
    'jwt_required',
    'token_required',
    'requires_auth',
    'require_login',
    'require_auth',
    'authenticated_only',
    'auth_required',
    'require_user',
    'verify_jwt',
    'verify_token',
    'verify_user',
    'verify_auth',
  ])('matches %s', (name) => {
    expect(isPythonAuthDecoratorName(name)).toBe(true)
  })

  it.each(['logger', 'cache', 'staticmethod', 'classmethod', 'property', 'pytest', ''])(
    'does NOT match %s',
    (name) => {
      expect(isPythonAuthDecoratorName(name)).toBe(false)
    },
  )
})

// ---------------------------------------------------------------------------
// Cache behavior
// ---------------------------------------------------------------------------

describe('import source caching', () => {
  it('reuses the same set across multiple calls on the same AST', () => {
    const r = root(`import sqlalchemy`)
    expect(detectPythonOrm(r)).toBe('sqlalchemy')
    expect(detectPythonWebFramework(r)).toBe('unknown')
    expect(detectPythonDataLib(r)).toBe('unknown')
  })

  it('treats different ASTs independently', () => {
    expect(detectPythonOrm(root(`import sqlalchemy`))).toBe('sqlalchemy')
    expect(detectPythonOrm(root(`import peewee`))).toBe('peewee')
  })
})
