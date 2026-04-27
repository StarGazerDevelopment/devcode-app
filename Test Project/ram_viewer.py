import psutil
import matplotlib.pyplot as plt
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
import tkinter as tk
import time

class RamViewer:
    def __init__(self, master):
        self.master = master
        self.master.title("RAM Viewer")
        self.fig, self.ax = plt.subplots()
        self.canvas = FigureCanvasTkAgg(self.fig, master=self.master)
        self.canvas.draw()
        self.canvas.get_tk_widget().pack()
        self.update_plot()

    def update_plot(self):
        ram_usage = psutil.virtual_memory().percent
        self.ax.clear()
        self.ax.plot([ram_usage])
        self.ax.set_ylim(0, 100)
        self.ax.set_ylabel("RAM Usage (%)")
        self.ax.set_title("RAM Viewer")
        self.canvas.draw()
        self.master.after(1000, self.update_plot)

root = tk.Tk()
ram_viewer = RamViewer(root)
root.mainloop()