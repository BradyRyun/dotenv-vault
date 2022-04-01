import * as dotenv from 'dotenv'
import * as crypto from 'node:crypto'
import axios, {AxiosRequestConfig, AxiosResponse} from 'axios'
import {vars} from '../vars'
import {existsSync, writeFileSync, readFileSync} from 'node:fs'
import {CliUx} from '@oclif/core'
import {AppendToGitignoreService} from '../services/append-to-gitignore-service'

interface PullServiceAttrs {
  cmd;
  environment;
  filename;
  dotenvMe;
}

class PullService {
  public cmd;
  public environment;
  public filename;
  public dotenvMe;
  public generatedMeUid;

  constructor(attrs: PullServiceAttrs = {} as PullServiceAttrs) {
    this.cmd = attrs.cmd
    this.environment = attrs.environment
    this.filename = attrs.filename
    this.dotenvMe = attrs.dotenvMe

    const rand = crypto.randomBytes(32).toString('hex')
    this.generatedMeUid = `me_${rand}` // only for use on auth call
  }

  get url(): string {
    return vars.apiUrl + '/pull'
  }

  get authUrl(): string {
    return vars.apiUrl + '/auth'
  }

  get verifyUrl(): string {
    return vars.apiUrl + '/verify'
  }

  get existingEnvProject(): boolean {
    return existsSync('.env.project')
  }

  get emptyEnvProject(): boolean {
    return !(this.projectUid && this.projectUid.toString().length > 1)
  }

  get envContent(): string {
    return readFileSync(this.smartFilename, 'utf8')
  }

  get emptyEnvMe(): boolean {
    return !(this.meUid && this.meUid.toString().length > 1)
  }

  get existingEnv(): boolean {
    return existsSync(this.smartFilename)
  }

  get existingEnvMe(): boolean {
    if (this.dotenvMe) {
      return true
    }

    return existsSync('.env.me')
  }

  get smartFilename(): string {
    // if user has set a filename for output then use that
    if (this.filename) {
      return this.filename
    }

    if (this.environment === 'development') {
      return '.env'
    }

    return `.env.${this.environment}`
  }

  get envProjectConfig(): any {
    return dotenv.config({path: '.env.project'}).parsed || {}
  }

  get envMeConfig(): any {
    return dotenv.config({path: '.env.me'}).parsed || {}
  }

  get projectUid(): any {
    return this.envProjectConfig.DOTENV_PROJECT
  }

  get meUid(): any {
    return this.envMeConfig.DOTENV_ME
  }

  async run(): Promise<void> {
    new AppendToGitignoreService().run()

    this._logCheckingForEnvProject()
    if (!this.existingEnvProject) {
      this._logMissingEnvProject()
      return
    }

    if (this.emptyEnvProject) {
      this._logEmptyEnvProject()
      return
    }

    this._logCheckingForEnvMe()
    if (this.existingEnvMe) {
      // edge case
      if (this.emptyEnvMe) {
        this._logEmptyEnvMe()
      } else {
        // pull
        await this._pull()
      }
    } else {
      // first time auth process
      await this._authEnvMe()
    }
  }

  _logCheckingForEnvProject(): void {
    this.cmd.log('local:')
    this.cmd.log('local: Checking for .env.project')
  }

  _logMissingEnvProject(): void {
    this.cmd.log('Aborted.')
    this.cmd.log('')
    this.cmd.log('You must have a .env.project identifier first. Try running npx doten-vault new')
  }

  _logEmptyEnvProject(): void {
    this.cmd.log('Aborted.')
    this.cmd.log('')
    this.cmd.log('You must have DOTENV_PROJECT set to some value in your .env.project file. Try deleting your .env.project file and running npx doten-vault new')
  }

  _logEmptyEnv(): void {
    this.cmd.log('Aborted.')
    this.cmd.log('')
    this.cmd.log(`Your ${this.smartFilename} file is empty. Please populate it with value(s)`)
  }

  _logCheckingForEnvMe(): void {
    this.cmd.log('local: Checking for .env.me')
  }

  async _createEnvMe(): Promise<void> {
    writeFileSync('.env.me', `DOTENV_ME=${this.generatedMeUid} # do NOT commit to git`)
  }

  async _authEnvMe(): Promise<void> {
    this.cmd.log('local: Generating .env.me credential')
    this._logProTip()

    const email = await CliUx.ux.prompt('What is your email address?', {type: 'mask'})

    this.cmd.log('remote: Securely sending a code')

    const options: AxiosRequestConfig = {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      data: {
        email: email,
        projectUid: this.projectUid,
        meUid: this.generatedMeUid,
      },
      url: this.authUrl,
    }

    // submit email for identification
    try {
      await axios(options)
      this.cmd.log('remote: Sent. Check your email.')
      this._createEnvMe()
      this._promptForShortCode()
    } catch (error) {
      this._logError(error)
    }
  }

  async _promptForShortCode(): Promise<void> {
    const shortCode = await CliUx.ux.prompt('What is the code?')

    this.cmd.log('remote: Verifying')

    const options: AxiosRequestConfig = {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      data: {
        shortCode: shortCode,
        projectUid: this.projectUid,
        meUid: this.meUid,
      },
      url: this.verifyUrl,
    }

    try {
      await axios(options)
      this.cmd.log('remote: Verified successfully')
      this._pull()
    } catch (error) {
      this._logError(error)
    }
  }

  async _pull(): Promise<void> {
    this.cmd.log('remote:')
    this.cmd.log(`remote: Securely pulling ${this.environment} to ${this.smartFilename}`)
    this.cmd.log('remote:')

    const options: AxiosRequestConfig = {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      data: {
        environment: this.environment,
        projectUid: this.projectUid,
        meUid: this.meUid,
      },
      url: this.url,
    }

    try {
      const resp: AxiosResponse = await axios(options)
      const newData = resp.data.data.dotenv
      writeFileSync(this.smartFilename, newData)
      this._logCompleted()
    } catch (error) {
      this._logError(error)
    }
  }

  _logCompleted(): void {
    this.cmd.log('Done.')
    this.cmd.log('')
    this.cmd.log('Next, try making a change to your .env file and then running npx dotenv-vault push')
    this.cmd.log('')
    this.cmd.log('    $ npx dotenv-vault push')
  }

  _logEmptyEnvMe(): void {
    this.cmd.log('Aborted.')
    this.cmd.log('')
    this.cmd.log('You must have DOTENV_ME set to some value in your .env.me file. Try deleting your .env.me file and running npx doten-vault pull?')
  }

  _logError(error: Record<string, unknown> | Error | any): void {
    this.cmd.log('Aborted.')
    this.cmd.log('')
    if (error.response) {
      if (error.response.data && error.response.data.errors && error.response.data.errors[0]) {
        this.cmd.log(error.response.data.errors[0].message)
      } else {
        this.cmd.log(error.response.data)
      }
    } else {
      this.cmd.log(error)
    }
  }

  _logProTip(): void {
    this.cmd.log('local:')
    this.cmd.log('local: 💡ProTip! The .env.me file securely identifies your machine against this project in Dotenv Vault')
    this.cmd.log('local:')
  }
}

export {PullService}
