import { Command } from 'commander'

const program = new Command()

program.name('truecourse').description('TrueCourse CLI')

program
  .command('analyze')
  .description('Analyze a repository')
  .option('--spec-compliance', 'Run spec compliance checks')
  .action(() => {})

const rules = program
  .command('rules')
  .description('Manage rules')

rules
  .command('enable <ruleKey>')
  .description('Enable a rule')
  .action(() => {})

program
  .command('telemetry')
  .description('Manage telemetry')
  .action(() => {})

