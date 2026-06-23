import { describe, it, expect } from 'vitest'
import { checkCodeRules } from '../../packages/analyzer/src/rules/combined-code-checker'
import { ALL_DEFAULT_RULES } from '../../packages/analyzer/src/rules/index'
import { parseCode } from '../../packages/analyzer/src/parser'

const enabledRules = ALL_DEFAULT_RULES.filter((r) => r.enabled)

function check(code: string) {
  const tree = parseCode(code, 'csharp')
  return checkCodeRules(tree, '/app/src/File.cs', code, enabledRules, 'csharp')
}

// ---------------------------------------------------------------------------
// architecture/deterministic/duplicate-import
// ---------------------------------------------------------------------------

describe('architecture/deterministic/duplicate-import (C#)', () => {
  it('detects a duplicated using directive', () => {
    const violations = check(`using System.Text.Json;
using System.Net.Http;
using System.Text.Json;

namespace App;
public class Worker { }
`)
    const matches = violations.filter((v) => v.ruleKey === 'architecture/deterministic/duplicate-import')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag distinct usings or different forms of the same target', () => {
    const violations = check(`using System.Text.Json;
using static System.Math;
using Json = System.Text.Json;

namespace App;
public class Worker { }
`)
    const matches = violations.filter((v) => v.ruleKey === 'architecture/deterministic/duplicate-import')
    expect(matches).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// architecture/deterministic/declarations-in-global-scope
// ---------------------------------------------------------------------------

describe('architecture/deterministic/declarations-in-global-scope (C#)', () => {
  it('detects a mutable static field', () => {
    const violations = check(`namespace App;
public class Cache
{
    public static int RequestCount = 0;
}
`)
    const matches = violations.filter((v) => v.ruleKey === 'architecture/deterministic/declarations-in-global-scope')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag readonly/const statics or instance fields', () => {
    const violations = check(`namespace App;
public class Config
{
    public const int MaxRetries = 3;
    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(30);
    private int _instanceCounter = 0;
}
`)
    const matches = violations.filter((v) => v.ruleKey === 'architecture/deterministic/declarations-in-global-scope')
    expect(matches).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// architecture/deterministic/unused-import
// ---------------------------------------------------------------------------

describe('architecture/deterministic/unused-import (C#)', () => {
  it('detects an unused alias using', () => {
    const violations = check(`using Fmt = System.Text.Json.JsonSerializer;

namespace App;
public class Worker
{
    public void Run() { Console.WriteLine("hi"); }
}
`)
    const matches = violations.filter((v) => v.ruleKey === 'architecture/deterministic/unused-import')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag a used alias or plain namespace usings', () => {
    const violations = check(`using Fmt = System.Text.Json.JsonSerializer;
using System.Collections.Generic;

namespace App;
public class Worker
{
    public string Run(object o) { return Fmt.Serialize(o); }
}
`)
    const matches = violations.filter((v) => v.ruleKey === 'architecture/deterministic/unused-import')
    expect(matches).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// helper for the C# rule batch below
// ---------------------------------------------------------------------------

function count(code: string, ruleKey: string): number {
  return check(code).filter((v) => v.ruleKey === ruleKey).length
}

// ---------------------------------------------------------------------------
// architecture/deterministic/action-missing-http-verb
// ---------------------------------------------------------------------------

describe('architecture/deterministic/action-missing-http-verb (C#)', () => {
  const key = 'architecture/deterministic/action-missing-http-verb'

  it('flags a controller action with no HTTP-verb attribute', () => {
    expect(count(`using Microsoft.AspNetCore.Mvc;
namespace Api;

[ApiController]
[Route("api/[controller]")]
public class OrdersController : ControllerBase
{
    public IActionResult List() => Ok();
}
`, key)).toBe(1)
  })

  it('does not flag actions that declare a verb or [NonAction] helpers', () => {
    expect(count(`using Microsoft.AspNetCore.Mvc;
namespace Api;

[ApiController]
[Route("api/[controller]")]
public class OrdersController : ControllerBase
{
    [HttpGet]
    public IActionResult List() => Ok();

    [HttpPost]
    public IActionResult Create() => Ok();

    [NonAction]
    public IActionResult Helper() => Ok();
}
`, key)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// architecture/deterministic/action-route-leading-slash
// ---------------------------------------------------------------------------

describe('architecture/deterministic/action-route-leading-slash (C#)', () => {
  const key = 'architecture/deterministic/action-route-leading-slash'

  it('flags an action route template starting with a slash', () => {
    expect(count(`using Microsoft.AspNetCore.Mvc;
namespace Api;

[ApiController]
[Route("api/[controller]")]
public class OrdersController : ControllerBase
{
    [HttpGet("/legacy")]
    public IActionResult Legacy() => Ok();
}
`, key)).toBe(1)
  })

  it('does not flag relative routes, ~/ overrides, or controller-level absolute routes', () => {
    expect(count(`using Microsoft.AspNetCore.Mvc;
namespace Api;

[ApiController]
[Route("/api/orders")]
public class OrdersController : ControllerBase
{
    [HttpGet("list")]
    public IActionResult List() => Ok();

    [HttpGet("~/legacy")]
    public IActionResult Legacy() => Ok();
}
`, key)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// architecture/deterministic/action-route-without-controller-route
// ---------------------------------------------------------------------------

describe('architecture/deterministic/action-route-without-controller-route (C#)', () => {
  const key = 'architecture/deterministic/action-route-without-controller-route'

  it('flags a controller whose actions carry route templates but it has no [Route]', () => {
    expect(count(`using Microsoft.AspNetCore.Mvc;
namespace Api;

[ApiController]
public class OrdersController : ControllerBase
{
    [HttpGet("list")]
    public IActionResult List() => Ok();
}
`, key)).toBe(1)
  })

  it('does not flag controllers with a [Route] or actions without relative templates', () => {
    expect(count(`using Microsoft.AspNetCore.Mvc;
namespace Api;

[ApiController]
[Route("api/orders")]
public class OrdersController : ControllerBase
{
    [HttpGet("list")]
    public IActionResult List() => Ok();
}
`, key)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// architecture/deterministic/api-controller-wrong-base
// ---------------------------------------------------------------------------

describe('architecture/deterministic/api-controller-wrong-base (C#)', () => {
  const key = 'architecture/deterministic/api-controller-wrong-base'

  it('flags an [ApiController] deriving from Controller', () => {
    expect(count(`using Microsoft.AspNetCore.Mvc;
namespace Api;

[ApiController]
[Route("api/[controller]")]
public class OrdersController : Controller
{
    [HttpGet]
    public IActionResult List() => Ok();
}
`, key)).toBe(1)
  })

  it('does not flag ControllerBase, or a plain MVC Controller without [ApiController]', () => {
    expect(count(`using Microsoft.AspNetCore.Mvc;
namespace Api;

[ApiController]
public class ApiOrders : ControllerBase
{
    [HttpGet]
    public IActionResult List() => Ok();
}

[Route("home")]
public class HomeController : Controller
{
    [HttpGet]
    public IActionResult Index() => View();
}
`, key)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// architecture/deterministic/azure-function-stateful
// ---------------------------------------------------------------------------

describe('architecture/deterministic/azure-function-stateful (C#)', () => {
  const key = 'architecture/deterministic/azure-function-stateful'

  it('flags a Function class holding a mutable static field', () => {
    expect(count(`namespace Api;

public class TickFunction
{
    private static int _invocations;

    [FunctionName("Tick")]
    public void Run() { _invocations++; }
}
`, key)).toBe(1)
  })

  it('does not flag readonly/const statics or non-function classes', () => {
    expect(count(`namespace Api;

public class TickFunction
{
    private static readonly int MaxRuns = 5;
    private const string Schedule = "0 */5 * * * *";

    [FunctionName("Tick")]
    public void Run() { }
}
`, key)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// architecture/deterministic/collection-missing-generic-interface
// ---------------------------------------------------------------------------

describe('architecture/deterministic/collection-missing-generic-interface (C#)', () => {
  const key = 'architecture/deterministic/collection-missing-generic-interface'

  it('flags a type implementing IEnumerable but not IEnumerable<T>', () => {
    expect(count(`using System.Collections;
namespace Api;

public class TokenBag : IEnumerable
{
    public IEnumerator GetEnumerator() => null;
}
`, key)).toBe(1)
  })

  it('does not flag a type implementing the generic counterpart', () => {
    expect(count(`using System.Collections;
using System.Collections.Generic;
namespace Api;

public class TokenBag : IEnumerable<string>, IEnumerable
{
    public IEnumerator<string> GetEnumerator() => null;
    IEnumerator IEnumerable.GetEnumerator() => null;
}
`, key)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// architecture/deterministic/exposes-generic-list
// ---------------------------------------------------------------------------

describe('architecture/deterministic/exposes-generic-list (C#)', () => {
  const key = 'architecture/deterministic/exposes-generic-list'

  it('flags a public method returning List<T>', () => {
    expect(count(`using System.Collections.Generic;
namespace Api;

public class OrderRepository
{
    public List<int> GetIds() => null;
}
`, key)).toBe(1)
  })

  it('does not flag interface return types, settable List properties, or private List members', () => {
    expect(count(`using System.Collections.Generic;
namespace Api;

public class OrderRepository
{
    public List<string> Names { get; set; }
    private List<int> _ids = new();
    public IList<int> GetIds() => null;
    private List<int> GetCache() => _ids;
}
`, key)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// architecture/deterministic/missing-modelstate-validation
// ---------------------------------------------------------------------------

describe('architecture/deterministic/missing-modelstate-validation (C#)', () => {
  const key = 'architecture/deterministic/missing-modelstate-validation'

  it('flags a non-[ApiController] action that binds a model without checking ModelState', () => {
    expect(count(`using Microsoft.AspNetCore.Mvc;
namespace Api;

[Route("orders")]
public class OrdersController : Controller
{
    [HttpPost]
    public IActionResult Create(OrderModel model)
    {
        _repo.Save(model);
        return RedirectToAction("Index");
    }
}
`, key)).toBe(1)
  })

  it('does not flag actions that check ModelState, or [ApiController] controllers', () => {
    expect(count(`using Microsoft.AspNetCore.Mvc;
namespace Api;

[Route("orders")]
public class OrdersController : Controller
{
    [HttpPost]
    public IActionResult Create(OrderModel model)
    {
        if (!ModelState.IsValid) return View(model);
        return RedirectToAction("Index");
    }

    [HttpGet]
    public IActionResult Get(int id) => View();
}
`, key)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// architecture/deterministic/missing-operationcontract
// ---------------------------------------------------------------------------

describe('architecture/deterministic/missing-operationcontract (C#)', () => {
  const key = 'architecture/deterministic/missing-operationcontract'

  it('flags a [ServiceContract] method lacking [OperationContract]', () => {
    expect(count(`namespace Api;

[ServiceContract]
public interface IOrderService
{
    [OperationContract]
    int Place(int id);

    bool Cancel(int id);
}
`, key)).toBe(1)
  })

  it('does not flag a contract whose methods are all OperationContracts, or non-contract types', () => {
    expect(count(`namespace Api;

[ServiceContract]
public interface IOrderService
{
    [OperationContract]
    int Place(int id);

    [OperationContract]
    bool Cancel(int id);
}

public interface IHelper
{
    int Add(int a, int b);
}
`, key)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// architecture/deterministic/nested-type-publicly-visible
// ---------------------------------------------------------------------------

describe('architecture/deterministic/nested-type-publicly-visible (C#)', () => {
  const key = 'architecture/deterministic/nested-type-publicly-visible'

  it('flags a public nested class', () => {
    expect(count(`namespace Api;

public class OrderProcessor
{
    public class State { }
}
`, key)).toBe(1)
  })

  it('does not flag private/internal nested types, nested enums, or top-level types', () => {
    expect(count(`namespace Api;

public class OrderProcessor
{
    private class State { }
    internal class Cache { }
    public enum Phase { Pending, Done }
}

public class TopLevel { }
`, key)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// architecture/deterministic/raw-request-access-in-action
// ---------------------------------------------------------------------------

describe('architecture/deterministic/raw-request-access-in-action (C#)', () => {
  const key = 'architecture/deterministic/raw-request-access-in-action'

  it('flags Request.Form access inside a controller action', () => {
    expect(count(`using Microsoft.AspNetCore.Mvc;
namespace Api;

public class UploadController : ControllerBase
{
    [HttpPost]
    public IActionResult Save()
    {
        var name = Request.Form["name"];
        return Ok();
    }
}
`, key)).toBe(1)
  })

  it('does not flag bound parameters or Request access outside a controller', () => {
    expect(count(`using Microsoft.AspNetCore.Mvc;
namespace Api;

public class UploadController : ControllerBase
{
    [HttpPost]
    public IActionResult Save([FromForm] string name)
    {
        return Ok(name);
    }
}

public class RequestLoggingMiddleware
{
    public void Inspect(HttpContext context)
    {
        var path = context.Request.Path;
    }
}
`, key)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// architecture/deterministic/type-outside-namespace
// ---------------------------------------------------------------------------

describe('architecture/deterministic/type-outside-namespace (C#)', () => {
  const key = 'architecture/deterministic/type-outside-namespace'

  it('flags a type declared in the global namespace', () => {
    expect(count(`using System;

public class GlobalHelper
{
    public void Run() { }
}
`, key)).toBe(1)
  })

  it('does not flag types under a file-scoped or block namespace', () => {
    expect(count(`namespace Api;

public class Scoped { }
`, key) + count(`namespace Api
{
    public class Blocked { }
}
`, key)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// architecture/deterministic/uri-parameter-as-string
// ---------------------------------------------------------------------------

describe('architecture/deterministic/uri-parameter-as-string (C#)', () => {
  const key = 'architecture/deterministic/uri-parameter-as-string'

  it('flags a URI-named string parameter on a public method', () => {
    expect(count(`namespace Api;

public class Notifier
{
    public void Send(string callbackUrl) { }
}
`, key)).toBe(1)
  })

  it('does not flag Uri-typed params, non-URI names, or private methods', () => {
    expect(count(`using System;
namespace Api;

public class Notifier
{
    public void Send(Uri callbackUrl) { }
    public void Tag(string name) { }
    private void Hidden(string targetUrl) { }
}
`, key)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// architecture/deterministic/uri-property-as-string
// ---------------------------------------------------------------------------

describe('architecture/deterministic/uri-property-as-string (C#)', () => {
  const key = 'architecture/deterministic/uri-property-as-string'

  it('flags a URI-named string property', () => {
    expect(count(`namespace Api;

public class Webhook
{
    public string CallbackUrl { get; set; }
}
`, key)).toBe(1)
  })

  it('does not flag Uri-typed or non-URI string properties', () => {
    expect(count(`using System;
namespace Api;

public class Webhook
{
    public Uri CallbackUrl { get; set; }
    public string Name { get; set; }
}
`, key)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// architecture/deterministic/uri-return-as-string
// ---------------------------------------------------------------------------

describe('architecture/deterministic/uri-return-as-string (C#)', () => {
  const key = 'architecture/deterministic/uri-return-as-string'

  it('flags a public method returning a URI as string', () => {
    expect(count(`namespace Api;

public class LinkBuilder
{
    public string BuildCallbackUrl() => null;
}
`, key)).toBe(1)
  })

  it('does not flag Uri returns, non-URI names, or private methods', () => {
    expect(count(`using System;
namespace Api;

public class LinkBuilder
{
    public Uri BuildCallbackUrl() => null;
    public string BuildName() => null;
    private string BuildEndpoint() => null;
}
`, key)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// architecture/deterministic/value-type-action-param-under-posting
// ---------------------------------------------------------------------------

describe('architecture/deterministic/value-type-action-param-under-posting (C#)', () => {
  const key = 'architecture/deterministic/value-type-action-param-under-posting'

  it('flags a non-nullable, non-required value-type property on a binding model', () => {
    expect(count(`namespace Api;

public class CreateOrderRequest
{
    public int Quantity { get; set; }
    public string Name { get; set; }
}
`, key)).toBe(1)
  })

  it('does not flag required/nullable/defaulted props, or non-model types', () => {
    expect(count(`namespace Api;

public class CreateOrderRequest
{
    public required int Quantity { get; set; }
    public int? Discount { get; set; }
    public int Page { get; set; } = 1;
    public string Name { get; set; }
}

public class Counter
{
    public int Value { get; set; }
}
`, key)).toBe(0)
  })
})

describe('architecture/deterministic/action-missing-producesresponsetype (C#)', () => {
  const KEY = 'architecture/deterministic/action-missing-producesresponsetype'
  const fired = (code: string) => check(code).filter((v) => v.ruleKey === KEY)

  it('flags a verb action with no [ProducesResponseType]', () => {
    const src = `using Microsoft.AspNetCore.Mvc;
public class OrdersController : ControllerBase {
  [HttpGet] public IActionResult Get() => Ok();
}`
    expect(fired(src).length).toBe(1)
  })

  it('does not flag an action that declares [ProducesResponseType]', () => {
    const src = `using Microsoft.AspNetCore.Mvc;
public class OrdersController : ControllerBase {
  [HttpGet]
  [ProducesResponseType(200)]
  public IActionResult Get() => Ok();
}`
    expect(fired(src).length).toBe(0)
  })

  it('does not flag when the class carries a [ProducesResponseType]', () => {
    const src = `using Microsoft.AspNetCore.Mvc;
[ProducesResponseType(500)]
public class OrdersController : ControllerBase {
  [HttpGet] public IActionResult Get() => Ok();
}`
    expect(fired(src).length).toBe(0)
  })

  it('does not flag a non-action method', () => {
    const src = `using Microsoft.AspNetCore.Mvc;
public class OrdersController : ControllerBase {
  private int Helper() => 0;
}`
    expect(fired(src).length).toBe(0)
  })

  it('does not flag a verb method on a non-controller class', () => {
    const src = `using Microsoft.AspNetCore.Mvc;
public class OrderService {
  [HttpGet] public IActionResult Get() => null;
}`
    expect(fired(src).length).toBe(0)
  })
})
