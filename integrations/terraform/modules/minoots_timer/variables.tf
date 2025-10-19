variable "api_key" {
  description = "MINOOTS API key"
  type        = string
}

variable "team" {
  description = "Team identifier"
  type        = string
}

variable "name" {
  description = "Timer name"
  type        = string
}

variable "duration" {
  description = "Timer duration (e.g. 5m, 1h)"
  type        = string
}

variable "metadata" {
  description = "Additional metadata to attach to the timer"
  type        = map(string)
  default     = {}
}

variable "api_base" {
  description = "Override API base URL"
  type        = string
  default     = ""
}
