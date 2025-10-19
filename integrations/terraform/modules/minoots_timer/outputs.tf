output "timer" {
  description = "Timer payload returned from the MINOOTS API"
  value       = jsondecode(file("${path.module}/minoots_timer.json"))
}
